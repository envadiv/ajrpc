/**
 * The negative numbered error codes are from the JSON-RPC specification. These
 * are largely informational at this point, though the hope would be that the
 * codes could be used for programmatic error recovery. If your error is not
 * covered by an existing code, feel free to add one in the positive integer
 * range.
 */
export declare enum JsonRpcErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,
    Closed = 10,
    HandlerError = 20
}
/**
 * This error class is designed for being transmitted over the JSON-RPC
 * protocol. It is also used directly to, for example, reject the promise
 * returned by the call method.
 */
export declare class JsonRpcError extends Error {
    code: JsonRpcErrorCode;
    id: string | null;
    data?: string;
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
    constructor(code: JsonRpcErrorCode, message: string, id: string | null, data?: string);
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
    setHandler(handler: (message: string) => void): void;
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
export declare class WebSocketChannel implements Channel {
    private ws;
    constructor(ws: IWebSocket);
    send(message: string): void;
    setHandler(handler: (message: string) => void): void;
    close(code?: number, reason?: string): void;
}
/**
 * A paired channel is a simple synchronous passthrough that allows two local
 * JsonRpc instances to communicate.
 */
export declare class PairedChannel implements Channel {
    private partner?;
    private handler;
    /**
     * When the break flag is true, the paired channel stops sending. This is
     * meant to allow tests of unreliable delivery and/or disconnects.
     */
    break: boolean;
    static create(): [PairedChannel, PairedChannel];
    send(message: string): void;
    setHandler(handler: (message: string) => void): void;
    /**
     * Sets the break flag so no further messages will be sent. This simulates
     * closing a network channel.
     */
    close(_code?: number, _reason?: string): void;
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
export declare class HeartbeatChannel implements Channel {
    private channel;
    private callback;
    private timeout;
    private timeoutId;
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
    constructor(channel: Channel, timeout: number, callback: () => void);
    /**
     * The heartbeat channel never intervenes in message sending, it's just a
     * straight passthrough to the underlying channel.
     */
    send(message: string): void;
    /**
     * Wraps the given handler in a function that resets the expiration timer
     * on any message and discards heartbeat messages so they don't interfere
     * with the main payload of the channel.
     * @param handler
     */
    setHandler(handler: (message: string) => void): void;
    /**
     * Clears the timeout and closes the underlying channel.
     */
    close(code?: number, reason?: string): void;
}
/**
 * The JsonRpc class represents a two-way communication channel between two
 * peers. The JSON-RPC spec refers to 'client' and 'server', where those roles
 * are caller and callee respectively. I disprefer that nomenclature. Each pair
 * of peers are connected by a Channel implementation, and I think of them as
 * being 'local' or 'remote'.
 */
export declare class JsonRpc {
    private channel;
    private pending;
    private counter;
    private methods;
    private inBatch;
    private batchMessages?;
    /**
     * The JsonRpc instance is 1:1 with an underlying channel. Once
     * constructed, the instance's channel cannot be changed.
     * @param channel Whatever transport mechanism you choose to use for your
     * RPC connection.
     */
    constructor(channel: Channel);
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
    method(name: string, impl: (...params: unknown[]) => unknown): void;
    /**
     * Closes the underlying channel and rejects any pending promises. This
     * will raise exceptions anywhere that async code is currently pending an
     * await on a promise returned by the call method. In the future Node may
     * crash if those promise rejections are not handled, so at least add a
     * `.catch()` if you don't have your `await rpc.call()` in a try/catch
     * block.
     */
    close(code?: number, reason?: string): void;
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
    call(method: string, ...params: unknown[]): Promise<unknown>;
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
    notify(method: string, ...params: unknown[]): void;
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
    batch(fn: () => void): void;
    /**
     * This handles incoming messages from the underlying channel. The heavy
     * lifting is delegated to the `process` method.
     * @param message The serialized JSON message from whatever channel we're
     * using.
     */
    private incoming;
    /**
     * This method processes incoming calls, notifies, results, and errors.
     * @param item A single parsed JSON-RPC request object as a plain old
     * JavaScript object
     */
    private process;
    /**
     * Logs the given exception and then sends it over the Channel to the peer.
     * @param error Either a plain Error, which will be upgraded to a
     * JsonRpcError, or a JsonRpcError directly. The latter is perferable any
     * time you have an id to return in the error response.
     */
    private error;
}
