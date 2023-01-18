import { test, expect, jest } from '@jest/globals';
import {
    Channel,
    HeartbeatChannel,
    JsonRpc,
    JsonRpcError,
    JsonRpcErrorCode,
    PairedChannel,
    WebSocketChannel,
} from './jsonrpc';


test("PairedChannel.send()", async () => {
    const [A, B] = PairedChannel.create();
    let resolve: (value: unknown) => void;
    const promise = new Promise(fn => {
        resolve = fn;
    });
    B.setHandler(jest.fn((arg) => resolve(arg)));

    A.send("test message");
    const result = await promise;

    expect(result).toEqual("test message");
});

test("PairedChannel.break = true", async () => {
    const [A, B] = PairedChannel.create();
    let resolve: (value: unknown) => void;

    const result1 = await new Promise(resolve => {
        B.setHandler(message => resolve(message));
        A.send("test message");
    });
    expect(result1).toEqual("test message");

    const spy = jest.fn();
    A.setHandler(spy);
    B.break = true;
    B.send("arbitrary");

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(spy).not.toBeCalled();
});

test("WebSocketChannel", async () => {
    class MockWebSocket {
        private channel: Channel;

        constructor(channel: Channel) {
            this.channel = channel;
        }

        addEventListener(
            type: string,
            handler: (event: MessageEvent) => void): void
        {
            this.channel.setHandler((message: string) => {
                handler(new MessageEvent('message', {data: message}));
            });
        }

        send(message: string): void {
            this.channel.send(message);
        }

        close(): void {
            this.channel.close();
        }
    }
    const
        [A, B] = PairedChannel.create(),
        local = new JsonRpc(new WebSocketChannel(new MockWebSocket(A))),
        remote = new JsonRpc(new WebSocketChannel(new MockWebSocket(B)));

    const impl = jest.fn((arg) => arg);
    remote.method("test", impl);

    const value = await local.call("test", "unique argument");
    expect(value).toBe("unique argument");

    local.close();
    remote.close();
});

test("HeartbeatChannel keepalive", async () => {
    const
        [A, B] = PairedChannel.create(),
        callback = jest.fn(),
        handler = jest.fn(),
        hbc = new HeartbeatChannel(A, 0.1, callback);

    // In a JsonRpc context, the handler would be set by the JsonRpc instance
    hbc.setHandler(handler);

    // Heartbeat messages should keep it alive, but should not pass through to 
    // the handler.
    for(let i = 0; i<10; i++) {
        B.send("HEARTBEAT");
        await new Promise(resolve => {
            setTimeout(resolve, 0.05 * 1000);
        });
    }

    expect(callback).not.toBeCalled();
    expect(handler).not.toBeCalled();

    // Non-heartbeat messages will also keep it alive, but should pass through 
    // to the handler.
    for(let i = 0; i<10; i++) {
        B.send(`{"jsonrpc": "2.0", "method": "notify", "params": [] }`);
        await new Promise(resolve => {
            setTimeout(resolve, 0.05 * 1000);
        });
    }

    expect(callback).not.toBeCalled();
    expect(handler).toBeCalledTimes(10);

    hbc.close();
});

test("HeartbeatChannel timeout", async () => {

    const
        [A, B] = PairedChannel.create(),
        callback = jest.fn(),
        handler = jest.fn(),
        hbc = new HeartbeatChannel(A, 0.1, callback);

    hbc.setHandler(handler);

    // First we're gonna keep it alive for a while
    for(let i = 0; i<10; i++) {
        B.send(`{"jsonrpc": "2.0", "method": "notify", "params": [] }`);
        await new Promise(resolve => {
            setTimeout(resolve, 0.05 * 1000);
        });
    }

    expect(callback).not.toBeCalled();
    expect(handler).toBeCalledTimes(10);

    // Now we'll exceed the timeout period with some quiet
    await new Promise(resolve => {
        setTimeout(resolve, 0.2 * 1000);
    })

    expect(callback).toBeCalled();

    hbc.close();
});

test("JsonRpc.call()", async () => {
    const
        [A, B] = PairedChannel.create(),
        local = new JsonRpc(A),
        remote = new JsonRpc(B),
        impl1 = jest.fn(() => "expected result"),
        impl2 = jest.fn((...params: unknown[]) => params);
    remote.method("test1", impl1);
    const result1 = await local.call("test1", "expected argument");

    expect(result1).toEqual("expected result");
    expect(impl1).lastCalledWith("expected argument");

    remote.method("test2", impl2);

    const params = [
        [null],
        [5],
        [true],
        [false],
        ["string"],
        [[]],
        [["a", "b", "c"]],
        [{}],
        [{"a": "b", "c": "d"}],
    ];
    for(let item of params) {
        const result2 = await local.call("test2", ...item);
        expect(result2).toEqual(item);
    }

    local.close();
    remote.close();
});

test("JsonRpc.notify()", async () => {
    const
        [A, B] = PairedChannel.create(),
        local = new JsonRpc(A),
        remote = new JsonRpc(B);
    
    let resolve: (value: unknown) => void;
    let promise = new Promise(fn => {
        resolve = fn;
    });
    const impl = jest.fn(() => resolve(undefined));
    
    remote.method("test", impl);
    local.notify("test", "expected argument");

    await promise;
    expect(impl).lastCalledWith("expected argument");

    promise = new Promise(fn => {
        resolve = fn;
    });
    local.notify("test", {"a": "b"});
    await promise;
    expect(impl).lastCalledWith({"a": "b"});

    local.close();
    remote.close();
});

test("JsonRpc.batch()", async () => {
    const
        [A, B] = PairedChannel.create(),
        local = new JsonRpc(A),
        remote = new JsonRpc(B);

    let resolve: (value: unknown) => void;
    const promise = new Promise(fn => {
        resolve = fn;
    });
    const impl = jest.fn(() => resolve(undefined));

    remote.method("callable", () => "callable result");
    remote.method("notice", impl);

    let callableResult: Promise<unknown> | null = null;
    local.batch(() => {
        callableResult = local.call("callable");
        local.notify("notice", "expected argument");
    });

    await promise;
    expect(impl).lastCalledWith("expected argument");
    if(callableResult === null) {
        expect(callableResult).toBeInstanceOf(Promise);
    } else {
        expect(await callableResult as Promise<unknown>)
            .toEqual("callable result");
    }

    local.close();
    remote.close();
});

test("JsonRpc.close() reject", async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const
        [A, B] = PairedChannel.create(),
        local = new JsonRpc(A);
    B.setHandler(() => {});

    // there is no remote, so this will never teriminate
    let promise = local.call("test");

    try {
        local.close();
        await promise;
    } catch(error) {
        expect(error).toBeInstanceOf(JsonRpcError);
        // type guard just here to satisfy TypeScript
        if(error instanceof JsonRpcError) {
            expect(error.code).toBe(JsonRpcErrorCode.Closed);
        }
    }
    spy.mockRestore();
});

test("JsonRpc.batch() empty", async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const
        [A, B] = PairedChannel.create(),
        local = new JsonRpc(A),

        remote = new JsonRpc(B);

    expect(() => {
        local.batch(() => {});
    }).toThrow(JsonRpcError);

    try {
        local.batch(() => {});
    } catch(error) {
        expect(error).toBeInstanceOf(JsonRpcError);
        if(error instanceof JsonRpcError) {
            expect(error.code).toEqual(JsonRpcErrorCode.InternalError);
        }
    }

    // Verify that running a batch hasn't killed the call method
    const impl = jest.fn(() => "expected result");
    remote.method("callable", impl);

    const result = await local.call("callable", "expected argument");
    expect(result).toEqual("expected result");
    expect(impl).lastCalledWith("expected argument");

    spy.mockRestore();
});

test("JsonRpc.call() InternalError", async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const
        [A, B] = PairedChannel.create(),
        local = new JsonRpc(A),
        remote = new JsonRpc(B);

    remote.method("test", () => { throw Error("test error") });

    try {
        await local.call("test");
    } catch(error) {
        expect(error).toBeInstanceOf(JsonRpcError);
        if(error instanceof JsonRpcError) {
            expect(error.code).toEqual(JsonRpcErrorCode.InternalError);
            expect(error.message).toEqual("test error");
        }
    }

    let resolve: () => void;
    let message: string;
    const promise: Promise<void> = new Promise(fn => resolve = fn);
    const handler = (str: string) => {
        const obj = JSON.parse(str);
        const { error: { code, message } } = obj as
            { error: { code: number, message: string } };

        expect(code).toBe(JsonRpcErrorCode.InternalError);
        expect(message).toBe("test error");
        resolve();
    };
    A.setHandler(handler)
    local.notify("test");
    await promise;

    spy.mockRestore();
});

test("JsonRpc.call() MethodNotFound error", async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const
        [A, B] = PairedChannel.create(),
        local = new JsonRpc(A);
    new JsonRpc(B);

    try {
        await local.call("test");
    } catch(error) {
        expect(error).toBeInstanceOf(JsonRpcError);
        if(error instanceof JsonRpcError) {
            expect(error.code).toEqual(JsonRpcErrorCode.MethodNotFound);
        }
    }

    let resolve: () => void;
    let message: string;
    const promise: Promise<void> = new Promise(fn => resolve = fn);
    const handler = (str: string) => {
        const obj = JSON.parse(str);
        const { error: { code, message } } = obj as
            { error: { code: number, message: string } };

        expect(code).toBe(JsonRpcErrorCode.MethodNotFound);
        resolve();
    };
    A.setHandler(handler)
    local.notify("test");
    await promise;

    spy.mockRestore();
});

test("JsonRpc InvalidRequest error", async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    const [A, B] = PairedChannel.create();
    new JsonRpc(B);

    const resolution = (): [Promise<unknown>, (value: unknown) => void] => {
        let resolve: (value: unknown) => void;
        const promise = new Promise(fn => resolve = fn);
        // the extra wrapper around resolve convinces TypeScript that it has 
        // been assigned a value before it's referenced.
        return [promise, (value: unknown) => resolve(value)];
    }

    let [promise, resolve] = resolution();

    const handler = jest.fn((value: unknown) => {
        const obj = JSON.parse(value as string);
        let { error: { code, message }, id } = obj as
            { error: { code: number, message: string }, id: string };
        expect(code).toBe(JsonRpcErrorCode.InvalidRequest);
        expect(id).toBeUndefined();
        expect(message).toBeDefined();
        resolve(undefined);
    });
    A.setHandler(handler);

    // Send the JsonRpc attached to the B side a result without an `id`
    A.send(`{"result": null}`);
    await promise;
    expect(handler).toBeCalled();

    handler.mockClear();
    [ promise, resolve ] = resolution();

    // Try sending one with an unmatched `id`
    A.send(`{"result": null, "id": "definitely doesn't exist"}`);
    await promise;
    expect(handler).toBeCalled();

    handler.mockClear();
    [ promise, resolve ] = resolution();

    // Here's one without any error, result, or method properties
    A.send('{ "does not matter": "not one bit" }');
    await promise;
    expect(handler).toBeCalled();

    handler.mockClear();
    [ promise, resolve ] = resolution();

    // Finally, a JSON parse error
    A.send('{');
    await promise;
    expect(handler).toBeCalled();

    spy.mockRestore();
    log.mockRestore();
});

test("JsonRpc InvalidParams error", async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const
        [A, B] = PairedChannel.create(),
        remote = new JsonRpc(B);

    const impl = jest.fn();
    remote.method("test", impl);

    const handler = jest.fn((value: unknown) => {
        const obj = JSON.parse(value as string);
        let { error: { code, message } } = obj as
            { error: { code: number, message: string } };
        expect(code).toBe(JsonRpcErrorCode.InvalidParams);
        expect(message).toBeDefined();
        resolve(undefined);
    });
    A.setHandler(handler);

    const resolution = (): [Promise<unknown>, (value: unknown) => void] => {
        let resolve: (value: unknown) => void;
        const promise = new Promise(fn => resolve = fn);
        // the extra wrapper around resolve convinces TypeScript that it has 
        // been assigned a value before it's referenced.
        return [promise, (value: unknown) => resolve(value)];
    }

    let [promise, resolve] = resolution();

    A.send(`{"method": "test", "id": 0, "params": "string" }`);
    await promise;
    expect(handler).toBeCalled();
    expect(impl).not.toBeCalled();

    [promise, resolve] = resolution();

    A.send(`{"method": "test", "params": false }`);
    await promise;
    expect(handler).toBeCalled();
    expect(impl).not.toBeCalled();

    spy.mockRestore();
});

test("JsonRpc.incoming() errors from peer", async () => {
    const [A, B] = PairedChannel.create();
    new JsonRpc(B);

    const promises: Promise<void>[] = [];

    const defer = (fn: () => void) => setTimeout(fn, 0);

    // This is only germane to this file because each test runs in a separate 
    // "thread". Supposedly.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
        A.send(`{"error": { "id": "identifiable value" } }`);
        promises.push(new Promise(resolve => {
            defer(() => {
                if(spy.mock.lastCall !== undefined) {
                    expect(spy.mock.lastCall[0]).toMatch(/identifiable value/);
                } else {
                    // this will fail if we hit this branch
                    expect(spy.mock.lastCall).toBeDefined();
                }
                resolve();
            });
        }));

        A.send(`{"error": { "doesn't": "matter" }}`);
        promises.push(new Promise(resolve => {
            defer(() => {
                expect(spy).toBeCalled();
                resolve();
            });
        }))

        await Promise.allSettled(promises);
    }
    finally {
        spy.mockRestore();
        log.mockRestore();
    }
});