
/**
 * The negative numbered error codes are from the JSON-RPC specification. These 
 * are largely informational at this point, though the hope would be that the 
 * codes could be used for programmatic error recovery. If your error is not 
 * covered by an existing code, feel free to add one in the positive integer 
 * range.
 */
export enum JsonRpcErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,

    Closed = 10,

    HandlerError = 20,
}

/**
 * This error class is designed for being transmitted over the JSON-RPC 
 * protocol. It is also used directly to, for example, reject the promise 
 * returned by the call method.
 */
export class JsonRpcError extends Error
{
    public code: JsonRpcErrorCode;
    public id: string | null;
    public data?: string;

    /**
     * 
     * @param code See https://www.jsonrpc.org/specification#error_object.
     * @param message Be helpful, be concise.
     * @param id If the error can be linked to a specific method invocation, 
     * then the id will match the id of the method that produced the error. The
     * id is null when no method call can be blamed for the error, e.g. a parse 
     * error that prevents the extraction of the id from the incoming message.
     * @param data Any additional information, likely a JSON object serialized 
     * as a string.
     */
    constructor(
        code: JsonRpcErrorCode,
        message: string,
        id: string | null,
        data?: string)
    {
        super(message);
        this.code = code;
        this.id = id;
        this.data = data;
    }
}

/**
 * In order to keep the JsonRpc class implementation from being tied to, for 
 * example, a WebSocket implementation, this Channel interface allows multiple
 * different underlying transport mechanisms. This is especially useful for 
 * testing since it avoids having to setup a WebSocket server for testing.
 */
export interface Channel {

    /**
     * Sends a serailized JSON message through the underlying channel.
     * @param message the JSON message encoded as a string, i.e. via
     * JSON.stringify()
     */
    send(message: string): void;

    /**
     * Register the message handler that will receive notification when a 
     * remote message arrives over the underlying channel.
     * @param handler an async method that receives the incomming message
     */
    setHandler(handler: (message: string) => void ): void;

    /**
     * Close the underlying channel.
     */
    close(code?: number, reason?: string): void;
}

/**
 * This is the necessary subset of the WebSocket interface that we need to 
 * implement the WebSocketChannel. Since TypeScript is happy to "structurally" 
 * type stuff, this should also work just fine with a proper WebSocket.
 */
export type IWebSocket = {
    addEventListener(type: 'message' | 'close', ...params: unknown[]): void;
    send(message: string): void;
    close(code?: number, reason?: string): void;
};

/**
 * The WebSocketChannel is a thin facade over a proper WebSocket.
 */
export class WebSocketChannel implements Channel {
    private ws: IWebSocket;

    constructor(ws: IWebSocket) {
        this.ws = ws;
    }

    send(message: string) {
        this.ws.send(message);
    }

    setHandler(handler: (message: string) => void) {
        // multiple calls to this method will produce duplicates...
        this.ws.addEventListener('message', (event: MessageEvent) => {
            handler(event.data);
        });
    }

    close(code?: number, reason?: string) {
        this.ws.close(code, reason);
    }
}

/**
 * A paired channel is a simple synchronous passthrough that allows two local 
 * JsonRpc instances to communicate.
 */
export class PairedChannel implements Channel {
    private partner?: PairedChannel;
    private handler: (message: string) => void = () => {};

    /**
     * When the break flag is true, the paired channel stops sending. This is 
     * meant to allow tests of unreliable delivery and/or disconnects.
     */
    public break: boolean = false;

    static create(): [PairedChannel, PairedChannel] {
        const A = new PairedChannel();
        const B = new PairedChannel();
        A.partner = B;
        B.partner = A;

        return [A, B];
    }

    send(message: string): void {
        if(! this.break) {
            setTimeout(() => {
                if(this.partner == undefined) {
                    console.error(
                        'PairedChannel.send() called before partner was set');
                } else {
                    this.partner.handler(message);
                }
            }, 0);    
        }
    }

    setHandler(handler: (message: string) => void): void {
        this.handler = handler;
    }
    
    /**
     * Sets the break flag so no further messages will be sent. This simulates 
     * closing a network channel.
     */
    close(_code?: number, _reason?: string): void {
        this.break = true;
    }
}

/**
 * A heartbeat channel wraps another channel and executes a callback when the 
 * heartbeat expires. Since WebSocket ping/pong messages are below the 
 * JavaScript API, and of dubious reliability and availability in exotic 
 * WebSocket clients, such as the Unreal WebSocket implementation... this is 
 * all implemented with the public Channel API. This simply drops messages that 
 * consist entirely of the string "HEARTBEAT". Other messages are passed to the 
 * underlying channel's handler.
 * 
 * In this scheme, the Backend is always receiving the heartbeat message and 
 * either the browser or the Unreal game instance are sending it.
 */
export class HeartbeatChannel implements Channel {

    private channel: Channel;
    private callback: () => void;
    private timeout: number;

    // Barf. Practially speaking, I doubt we'll use this in the browser, and 
    // in practice the type annotation doesn't matter. But it irks me to have 
    // to mention the name of the abomination.
    private timeoutId: NodeJS.Timeout;

    /**
     * The timeout interval is started immediately in the constructor.
     * @param channel A channel to wrap. Could be any type of channel, doesn't 
     * matter. Typically you could discard reference to the underlying channel 
     * and just retain the heartbeat channel, unless the underlying channel 
     * offers special APIs.
     * @param callback When this class detects that timeout has expired without 
     * receiving a heartbeat, the callback is executed so that the channel can 
     * be closed, or whatever is sensible for your application.
     * @param timeout A measurement in seconds specifying how long before the 
     * channel should close. If you set the timeout to 10 seconds, then the 
     * sender should set their send interval to 5 seconds, a 2x error margin. 
     * For WebSockets, the concern is that a proxy might close the connection 
     * after 30 seconds, so I think a 40 second timeout period with a 20 second 
     * heartbeat interval would work well.
     */
    constructor(channel: Channel, timeout: number, callback: () => void) {
        this.channel = channel;
        this.callback = callback;
        this.timeout = timeout;
        this.timeoutId = setTimeout(this.callback, this.timeout * 1000);
    }

    /**
     * The heartbeat channel never intervenes in message sending, it's just a 
     * straight passthrough to the underlying channel.
     */
    send(message: string): void {
        this.channel.send(message);
    }

    /**
     * Wraps the given handler in a function that resets the expiration timer 
     * on any message and discards heartbeat messages so they don't interfere 
     * with the main payload of the channel.
     * @param handler 
     */
    setHandler(handler: (message: string) => void): void {
        this.channel.setHandler((message: string) => {

            // Any message will reset the expiration timer
            clearTimeout(this.timeoutId);
            this.timeoutId = setTimeout(this.callback, this.timeout * 1000);

            //if(message === 'HEARTBEAT') console.log('confirming got heartbeat');

            if(message !== "HEARTBEAT") {
                handler(message);
            }
        });
    }

    /**
     * Clears the timeout and closes the underlying channel.
     */
    close(code?: number, reason?: string): void {
        clearTimeout(this.timeoutId);
        this.channel.close(code, reason);
    }
}

/**
 * The PromiseResolution type is essentially a struct for storing information 
 * about a `call` that is pending.
 */
type PromiseResolution = {
    method: string;
    params: unknown[];
    promise: Promise<unknown>;
    resolve: (...params: unknown[]) => unknown;
    reject: (error: unknown) => void;
};

/**
 * The JsonRpc class represents a two-way communication channel between two 
 * peers. The JSON-RPC spec refers to 'client' and 'server', where those roles 
 * are caller and callee respectively. I disprefer that nomenclature. Each pair 
 * of peers are connected by a Channel implementation, and I think of them as 
 * being 'local' or 'remote'.
 */
export class JsonRpc {

    private channel: Channel;
    private pending: Map< string, PromiseResolution >;
    private counter: number = 0;
    private methods: Map< string, (...params: unknown[]) => unknown >;
    private inBatch: boolean = false;
    private batchMessages?: object[];

    /**
     * The JsonRpc instance is 1:1 with an underlying channel. Once 
     * constructed, the instance's channel cannot be changed.
     * @param channel Whatever transport mechanism you choose to use for your 
     * RPC connection.
     */
    public constructor(channel: Channel) {
        this.methods = new Map();
        this.pending = new Map();

        this.channel = channel;
        this.channel.setHandler(this.incoming.bind(this));
    }

    /**
     * Adds a method implementation to this instance. Remember that any code 
     * you expose as a method has the potential to result in remote execution, 
     * so be wary of the data you receive in your implementation, just as if 
     * you received data from an HTML form or any other untrusted source. That 
     * is to say: don't exec anything you get from the network.
     * @param name The name that the remote peer will use to call the 
     * implementation you provide. For example, if the frontend adds a `test`
     * method to its JsonRpc instance, then the backend can call that method by 
     * executing the call method on its own JsonRpc instance. The frontend 
     * can't call its own `test` method via its JsonRpc instance.
     * @param impl An (optionally) async function that implements the procedure 
     * call. The returned promise/value must be JSON serializable, and its 
     * value will be returned to the remote peer when the peer has invoked this
     * method with a call. If this method is called with a notify, then the 
     * return value will be ignored.
     */
    public method(name: string, impl: (...params: unknown[]) => unknown)
    {
        this.methods.set(name, impl);
    }

    /**
     * Closes the underlying channel and rejects any pending promises. This 
     * will raise exceptions anywhere that async code is currently pending an 
     * await on a promise returned by the call method. In the future Node may 
     * crash if those promise rejections are not handled, so at least add a 
     * `.catch()` if you don't have your `await rpc.call()` in a try/catch 
     * block.
     */
    public close(code?: number, reason?: string) {
        this.channel.close(code, reason);
        for(let resolution of this.pending.values()) {
            resolution.reject(
                new JsonRpcError(
                    JsonRpcErrorCode.Closed,
                    'JSON-RPC closed before response received',
                    `${resolution.method} ${JSON.stringify(resolution.params)}`
                ));
        }
    }

    /**
     * Invokes a method defined on the remote peer and returns a promise that 
     * will resolve to its return value. Note that this implementation does not 
     * currently have a timeout option, which means that some promises may take 
     * a very long time to resolve.
     * @param method The name of the method defined on the remote peer. So if 
     * the frontend defined a `test` method on its JsonRpc instance, then the 
     * backend can invoke that method by calling `call('test', ...)` on its own 
     * JsonRpc instance.
     * @param params Multiple positional arguments will be transmitted as a 
     * serialized JSON array. On the remote side, this will be interpreted as 
     * positional parameters. If you only pass a single object, i.e.
     * 
     *      rpc.call('method', {"named": "parameters"})
     * 
     * Then that object is serialized and sent providing more of a "named 
     * parameters" style of invocation. If you want to avoid this behavior, 
     * include a trailing undefined value in the invocation, which will be 
     * filtered out before sending, i.e.
     * 
     *     rpc.call('method', {"named": "parameters"}, undefined)
     * 
     * @returns A promise that will resolve to whatever the remote 
     * implementation returns. This promise may be rejected if the JsonRpc 
     * instance is explicitly closed before the promise resolves. And the 
     * promise will definitely be rejected if the remote peer returns an error 
     * in response to this call. So make sure to catch any errors.
     */
    public call(method: string, ...params: unknown[]): Promise<unknown> {
        const id = String(this.counter++);
        let message: object;
        // if we received one object like {}, then we pass that as keyword 
        // arguments to the other side
        if(params.length == 1 &&
            params[0] != null &&
            Object.getPrototypeOf(params[0]) === Object.prototype)
        {
            message = {
                jsonrpc: "2.0",
                method,
                params: params[0],
                id,
                };
        }
        // otherwise we pass the aggregated params directly as an array of 
        // positional arguments
        else {
            message = {
                jsonrpc: "2.0",
                method,
                params: params.filter(p => p !== undefined),
                id,
                };
        }

        if(this.inBatch) {
            this.batchMessages?.push(message);
        } else {
            this.channel.send(JSON.stringify(message));
        }

        let promise: Promise<unknown>;
        promise = new Promise((resolve, reject) => {
            const resolution = {
                method,
                params,
                promise,
                resolve,
                reject
            };
            this.pending.set(String(id), resolution);
        });
        return promise;
    }

    /**
     * The notify method is like the call method, but it doesn't expect a 
     * return value from the peer. Since this doesn't return anything, you also 
     * don't have to worry about long-running promises or potential exceptions 
     * at close time. The best use for notify is when no confirmation of the 
     * procedure's outcome is needed, for example, if you send updated 
     * information regularly, then a dropped notify will be corrected by the 
     * next notify.
     * @param method Same as the method argument to the `call` method
     * @param params Same as the params argumentt to the `call` method
     */
    public notify(method: string, ...params: unknown[]): void {
        let message: object;
        if(params.length == 1 &&
            params[0] != null &&
            Object.getPrototypeOf(params[0]) === Object.prototype)
        {
            message = {
                jsonrpc: "2.0",
                method,
                params: params[0],
                };
        } else {
            message = {
                jsonrpc: "2.0",
                method,
                params,
                };
        }
        if(this.inBatch) {
            this.batchMessages?.push(message);
        } else {
            this.channel.send(JSON.stringify(message));
        }
    }

    /**
     * If you need to make many simultaneous calls to one RPC peer, then you've 
     * come to the right place. This will send all the calls as an array in a 
     * single message, hopefully cutting message channel overhead and parsing 
     * time. The usage looks like this:
     * 
     *     rpc.batch(() => {
     *          rpc.call("spiffy", "argument1", "argument2")
     *              .then(result => {...});
     *          rpc.notify("spotty", "argument1", "argument2")
     *     });
     * 
     * The other side will receive a batch of messages like:
     * 
     *     [
     *          { 
     *              "method": "spiffy",
     *              "params": ["argument1", "argument2"],
     *              ...
     *          },
     *          { 
     *              "method": "spotty",
     *              "params": ["argument1", "argument2"],
     *              ...
     *          }
     * 
     * Note: currently this is off-spec in that it does not return results to 
     * the remote peer in an array. That fact reduces the performance gains of 
     * batching somewhat.
     * 
     * @param fn the function where you call the RPC instance's `call` or 
     * `notify` methods, each of which will get included in the batch. This 
     * MUST NOT be an async function, or the batch will remain empty and your 
     * calls/notifies will execute individually.
     */
    public batch(fn: () => void): void {
        this.inBatch = true;
        this.batchMessages = new Array();
        try {
            fn();
            if(this.batchMessages.length > 0) {
                this.channel.send(JSON.stringify(this.batchMessages));
            } else {
                throw new JsonRpcError(
                    JsonRpcErrorCode.InternalError,
                    "Empty batch",
                    null);
            }
        } finally {
            // Finally we restore the channel.
            this.inBatch = false;
            delete this.batchMessages;
        }
    }

    /**
     * This handles incoming messages from the underlying channel. The heavy 
     * lifting is delegated to the `process` method.
     * @param message The serialized JSON message from whatever channel we're 
     * using.
     */
    private incoming(message: string): void {
        let obj: object;
        try{
            obj = JSON.parse(message);
        } catch(error) {
            this.error(new JsonRpcError(
                JsonRpcErrorCode.InvalidRequest,
                (error as Error).message,
                null,
            ));
            return;
        }
        // In the case of a batch, we process each line
        if(Array.isArray(obj)) {
            for(let item of obj) {
                // don't really care about the resolution of this promise,
                // but we do need to catch it if it rejects so that Node 
                // doesn't die in future versions.
                this.process(item).catch(error => this.error(error));
            }
        } else {
            // See note above about catching unhandled promise rejections
            this.process(obj).catch(error => this.error(error));
        }
    }

    /**
     * This method processes incoming calls, notifies, results, and errors.
     * @param item A single parsed JSON-RPC request object as a plain old 
     * JavaScript object
     */
    private async process(item: object) {
        // handle calls and notifies
        if("method" in item) {
            const { method, params, id } =
                item as { method: string, params: unknown, id: string };

            // method + id -> call. I do really intend a non-strict equality 
            // here because this allows id to be null or undefined in a notify.
            if(id != null) {
                if(this.methods.has(method)) {
                    const impl = 
                        this.methods.get(method) as
                            (...params: unknown[]) => unknown;
                    let result: unknown;
                    try {
                        if(Array.isArray(params)) {
                            result = await impl(...params);
                        }
                        else if (Object.getPrototypeOf(params) === 
                            Object.prototype)
                        {
                            result = await impl(params);
                        } else {
                            this.error(new JsonRpcError(
                                JsonRpcErrorCode.InvalidParams,
                                "The call parameters must be either a positional array or an object",
                                id,
                                JSON.stringify(item),
                            ));
                            return;
                        }
                    } catch(error) {
                        this.error(new JsonRpcError(
                            JsonRpcErrorCode.InternalError,
                            (error as Error).message,
                            id,
                        ));
                        return;
                    }

                    // JSON.stringify won't seralize an undefined value, so we 
                    // replace it with null to ensure we have a 'result' 
                    // property in the response.
                    if(result === undefined) {
                        result = null;
                    }

                    this.channel.send(JSON.stringify({
                        "jsonrpc": "2.0",
                        id,
                        result,
                    }));
                }
                else {
                    this.error(new JsonRpcError(
                        JsonRpcErrorCode.MethodNotFound,
                        `No available method named "${method}"`,
                        id,
                        ));
                }
            }
            // method without id -> notify
            else {
                if(this.methods.has(method)) {
                    const impl = this.methods.get(method) as
                        (...params: unknown[]) => unknown;
                    
                    try {
                        if(Array.isArray(params)) {
                            await impl(...params);
                        }
                        else if (Object.getPrototypeOf(params) ===
                            Object.prototype)
                        {
                            await impl(params);
                        }
                        else {
                            this.error(new JsonRpcError(
                                JsonRpcErrorCode.InvalidParams,
                                "The call parameters must be either a positional array or an object",
                                null,
                                JSON.stringify(item),
                            ));
                        }
                    } catch(error) {
                        this.error(error as Error);
                        return;
                    }
                }
                else {
                    this.error(new JsonRpcError(
                        JsonRpcErrorCode.MethodNotFound,
                        `No available method named "${method}"`,
                        null,
                        ));
                }
            }
        }
        // handle results
        else if("result" in item) {
            const { result, id } =
                item as { result: string, id: string };
            // id could be zero, null, or undefined. Since zero is falsey, we
            // check non-strict against null, which catches null or undefined.
            if(id != null) {
                if(this.pending.has(String(id))) {
                    const resolution =
                        this.pending.get(id) as PromiseResolution;
                    resolution.resolve(result);
                    this.pending.delete(id);
                } else {
                    this.error(new JsonRpcError(
                        JsonRpcErrorCode.InvalidRequest,
                        `Unmatched id "${id}" in incoming result response`,
                        null,
                        JSON.stringify(item),
                        ));
                }
            } else {
                this.error(new JsonRpcError(
                    JsonRpcErrorCode.InvalidRequest,
                    'No id field in result',
                    null,
                    JSON.stringify(item),
                ));
            }
        }
        // handle errors
        else if("error" in item) {
            const { message, code, id, data } = item["error"] as any;
            if(id) {
                if(this.pending.has(id)) {
                    const resolution =
                        this.pending.get(id) as PromiseResolution;
                    resolution.reject(
                        new JsonRpcError(code, message, id, data));
                    this.pending.delete(id);
                    } else {
                    // No sense in bouncing this back to the peer, it's 
                    // probably already logged there as an error, so it would 
                    // just create more noise. Party like it's 1999 and we're 
                    // writing perl, so we can do some shortcircuit stuff...
                    console.error(
                        `Unmatched id "${id}" in incoming error response`,
                        item);
                }
            } else {
                console.error(
                    "Unidentified error on JsonRpc peer:",
                    message, code, data);
            }
            
        }
        else {
            // otherwise, we don't know what this is, so it's an invalid 
            // request. We do know that item is at least serializable because 
            // it was just deserialized in the incoming method.
            const data = JSON.stringify(item);
            this.error(new JsonRpcError(
                JsonRpcErrorCode.InvalidRequest,
                "The request object needs to have a method, result, or error. Original in data member.",
                "id" in item ? item["id"] as string : null,
                data
                ));
        }
    }

    /**
     * Logs the given exception and then sends it over the Channel to the peer.
     * @param error Either a plain Error, which will be upgraded to a 
     * JsonRpcError, or a JsonRpcError directly. The latter is perferable any 
     * time you have an id to return in the error response.
     */
    private error(error: Error) {
        console.log(
            'JsonRpc.error() logging error before sending to peer:',
            error
        );
        if(error instanceof JsonRpcError) {
            let message: string;
            if(error.data) {
                message = JSON.stringify({
                    "jsonrpc": "2.0",
                    "error": {
                        code: error.code,
                        message: error.message,
                        id: error.id,
                        data: error.data,
                    }
                });
            } else {
                message = JSON.stringify({
                    "jsonrpc": "2.0",
                    "error": {
                        code: error.code,
                        message: error.message,
                        id: error.id,
                    }
                });    
            }
            this.channel.send(message);
        }
        else {
            const message = JSON.stringify({
                "jsonrpc": "2.0",
                "error": {
                    code: JsonRpcErrorCode.InternalError,
                    message: error.message,
                    id: null,
                }
            });
            this.channel.send(message);
        }
    }
}