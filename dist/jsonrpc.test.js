"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const jsonrpc_1 = require("./jsonrpc");
(0, globals_1.test)("PairedChannel.send()", () => __awaiter(void 0, void 0, void 0, function* () {
    const [A, B] = jsonrpc_1.PairedChannel.create();
    let resolve;
    const promise = new Promise(fn => {
        resolve = fn;
    });
    B.setHandler(globals_1.jest.fn((arg) => resolve(arg)));
    A.send("test message");
    const result = yield promise;
    (0, globals_1.expect)(result).toEqual("test message");
}));
(0, globals_1.test)("PairedChannel.break = true", () => __awaiter(void 0, void 0, void 0, function* () {
    const [A, B] = jsonrpc_1.PairedChannel.create();
    let resolve;
    const result1 = yield new Promise(resolve => {
        B.setHandler(message => resolve(message));
        A.send("test message");
    });
    (0, globals_1.expect)(result1).toEqual("test message");
    const spy = globals_1.jest.fn();
    A.setHandler(spy);
    B.break = true;
    B.send("arbitrary");
    yield new Promise(resolve => setTimeout(resolve, 100));
    (0, globals_1.expect)(spy).not.toBeCalled();
}));
(0, globals_1.test)("WebSocketChannel", () => __awaiter(void 0, void 0, void 0, function* () {
    class MockWebSocket {
        constructor(channel) {
            this.channel = channel;
        }
        addEventListener(type, handler) {
            this.channel.setHandler((message) => {
                handler(new MessageEvent('message', { data: message }));
            });
        }
        send(message) {
            this.channel.send(message);
        }
        close() {
            this.channel.close();
        }
    }
    const [A, B] = jsonrpc_1.PairedChannel.create(), local = new jsonrpc_1.JsonRpc(new jsonrpc_1.WebSocketChannel(new MockWebSocket(A))), remote = new jsonrpc_1.JsonRpc(new jsonrpc_1.WebSocketChannel(new MockWebSocket(B)));
    const impl = globals_1.jest.fn((arg) => arg);
    remote.method("test", impl);
    const value = yield local.call("test", "unique argument");
    (0, globals_1.expect)(value).toBe("unique argument");
    local.close();
    remote.close();
}));
(0, globals_1.test)("HeartbeatChannel keepalive", () => __awaiter(void 0, void 0, void 0, function* () {
    const [A, B] = jsonrpc_1.PairedChannel.create(), callback = globals_1.jest.fn(), handler = globals_1.jest.fn(), hbc = new jsonrpc_1.HeartbeatChannel(A, 0.1, callback);
    // In a JsonRpc context, the handler would be set by the JsonRpc instance
    hbc.setHandler(handler);
    // Heartbeat messages should keep it alive, but should not pass through to 
    // the handler.
    for (let i = 0; i < 10; i++) {
        B.send("HEARTBEAT");
        yield new Promise(resolve => {
            setTimeout(resolve, 0.05 * 1000);
        });
    }
    (0, globals_1.expect)(callback).not.toBeCalled();
    (0, globals_1.expect)(handler).not.toBeCalled();
    // Non-heartbeat messages will also keep it alive, but should pass through 
    // to the handler.
    for (let i = 0; i < 10; i++) {
        B.send(`{"jsonrpc": "2.0", "method": "notify", "params": [] }`);
        yield new Promise(resolve => {
            setTimeout(resolve, 0.05 * 1000);
        });
    }
    (0, globals_1.expect)(callback).not.toBeCalled();
    (0, globals_1.expect)(handler).toBeCalledTimes(10);
    hbc.close();
}));
(0, globals_1.test)("HeartbeatChannel timeout", () => __awaiter(void 0, void 0, void 0, function* () {
    const [A, B] = jsonrpc_1.PairedChannel.create(), callback = globals_1.jest.fn(), handler = globals_1.jest.fn(), hbc = new jsonrpc_1.HeartbeatChannel(A, 0.1, callback);
    hbc.setHandler(handler);
    // First we're gonna keep it alive for a while
    for (let i = 0; i < 10; i++) {
        B.send(`{"jsonrpc": "2.0", "method": "notify", "params": [] }`);
        yield new Promise(resolve => {
            setTimeout(resolve, 0.05 * 1000);
        });
    }
    (0, globals_1.expect)(callback).not.toBeCalled();
    (0, globals_1.expect)(handler).toBeCalledTimes(10);
    // Now we'll exceed the timeout period with some quiet
    yield new Promise(resolve => {
        setTimeout(resolve, 0.2 * 1000);
    });
    (0, globals_1.expect)(callback).toBeCalled();
    hbc.close();
}));
(0, globals_1.test)("JsonRpc.call()", () => __awaiter(void 0, void 0, void 0, function* () {
    const [A, B] = jsonrpc_1.PairedChannel.create(), local = new jsonrpc_1.JsonRpc(A), remote = new jsonrpc_1.JsonRpc(B), impl1 = globals_1.jest.fn(() => "expected result"), impl2 = globals_1.jest.fn((...params) => params);
    remote.method("test1", impl1);
    const result1 = yield local.call("test1", "expected argument");
    (0, globals_1.expect)(result1).toEqual("expected result");
    (0, globals_1.expect)(impl1).lastCalledWith("expected argument");
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
        [{ "a": "b", "c": "d" }],
    ];
    for (let item of params) {
        const result2 = yield local.call("test2", ...item);
        (0, globals_1.expect)(result2).toEqual(item);
    }
    local.close();
    remote.close();
}));
(0, globals_1.test)("JsonRpc.notify()", () => __awaiter(void 0, void 0, void 0, function* () {
    const [A, B] = jsonrpc_1.PairedChannel.create(), local = new jsonrpc_1.JsonRpc(A), remote = new jsonrpc_1.JsonRpc(B);
    let resolve;
    let promise = new Promise(fn => {
        resolve = fn;
    });
    const impl = globals_1.jest.fn(() => resolve(undefined));
    remote.method("test", impl);
    local.notify("test", "expected argument");
    yield promise;
    (0, globals_1.expect)(impl).lastCalledWith("expected argument");
    promise = new Promise(fn => {
        resolve = fn;
    });
    local.notify("test", { "a": "b" });
    yield promise;
    (0, globals_1.expect)(impl).lastCalledWith({ "a": "b" });
    local.close();
    remote.close();
}));
(0, globals_1.test)("JsonRpc.batch()", () => __awaiter(void 0, void 0, void 0, function* () {
    const [A, B] = jsonrpc_1.PairedChannel.create(), local = new jsonrpc_1.JsonRpc(A), remote = new jsonrpc_1.JsonRpc(B);
    let resolve;
    const promise = new Promise(fn => {
        resolve = fn;
    });
    const impl = globals_1.jest.fn(() => resolve(undefined));
    remote.method("callable", () => "callable result");
    remote.method("notice", impl);
    let callableResult = null;
    local.batch(() => {
        callableResult = local.call("callable");
        local.notify("notice", "expected argument");
    });
    yield promise;
    (0, globals_1.expect)(impl).lastCalledWith("expected argument");
    if (callableResult === null) {
        (0, globals_1.expect)(callableResult).toBeInstanceOf(Promise);
    }
    else {
        (0, globals_1.expect)(yield callableResult)
            .toEqual("callable result");
    }
    local.close();
    remote.close();
}));
(0, globals_1.test)("JsonRpc.close() reject", () => __awaiter(void 0, void 0, void 0, function* () {
    const spy = globals_1.jest.spyOn(console, 'log').mockImplementation(() => { });
    const [A, B] = jsonrpc_1.PairedChannel.create(), local = new jsonrpc_1.JsonRpc(A);
    B.setHandler(() => { });
    // there is no remote, so this will never teriminate
    let promise = local.call("test");
    try {
        local.close();
        yield promise;
    }
    catch (error) {
        (0, globals_1.expect)(error).toBeInstanceOf(jsonrpc_1.JsonRpcError);
        // type guard just here to satisfy TypeScript
        if (error instanceof jsonrpc_1.JsonRpcError) {
            (0, globals_1.expect)(error.code).toBe(jsonrpc_1.JsonRpcErrorCode.Closed);
        }
    }
    spy.mockRestore();
}));
(0, globals_1.test)("JsonRpc.batch() empty", () => __awaiter(void 0, void 0, void 0, function* () {
    const spy = globals_1.jest.spyOn(console, 'log').mockImplementation(() => { });
    const [A, B] = jsonrpc_1.PairedChannel.create(), local = new jsonrpc_1.JsonRpc(A), remote = new jsonrpc_1.JsonRpc(B);
    (0, globals_1.expect)(() => {
        local.batch(() => { });
    }).toThrow(jsonrpc_1.JsonRpcError);
    try {
        local.batch(() => { });
    }
    catch (error) {
        (0, globals_1.expect)(error).toBeInstanceOf(jsonrpc_1.JsonRpcError);
        if (error instanceof jsonrpc_1.JsonRpcError) {
            (0, globals_1.expect)(error.code).toEqual(jsonrpc_1.JsonRpcErrorCode.InternalError);
        }
    }
    // Verify that running a batch hasn't killed the call method
    const impl = globals_1.jest.fn(() => "expected result");
    remote.method("callable", impl);
    const result = yield local.call("callable", "expected argument");
    (0, globals_1.expect)(result).toEqual("expected result");
    (0, globals_1.expect)(impl).lastCalledWith("expected argument");
    spy.mockRestore();
}));
(0, globals_1.test)("JsonRpc.call() InternalError", () => __awaiter(void 0, void 0, void 0, function* () {
    const spy = globals_1.jest.spyOn(console, 'log').mockImplementation(() => { });
    const [A, B] = jsonrpc_1.PairedChannel.create(), local = new jsonrpc_1.JsonRpc(A), remote = new jsonrpc_1.JsonRpc(B);
    remote.method("test", () => { throw Error("test error"); });
    try {
        yield local.call("test");
    }
    catch (error) {
        (0, globals_1.expect)(error).toBeInstanceOf(jsonrpc_1.JsonRpcError);
        if (error instanceof jsonrpc_1.JsonRpcError) {
            (0, globals_1.expect)(error.code).toEqual(jsonrpc_1.JsonRpcErrorCode.InternalError);
            (0, globals_1.expect)(error.message).toEqual("test error");
        }
    }
    let resolve;
    let message;
    const promise = new Promise(fn => resolve = fn);
    const handler = (str) => {
        const obj = JSON.parse(str);
        const { error: { code, message } } = obj;
        (0, globals_1.expect)(code).toBe(jsonrpc_1.JsonRpcErrorCode.InternalError);
        (0, globals_1.expect)(message).toBe("test error");
        resolve();
    };
    A.setHandler(handler);
    local.notify("test");
    yield promise;
    spy.mockRestore();
}));
(0, globals_1.test)("JsonRpc.call() MethodNotFound error", () => __awaiter(void 0, void 0, void 0, function* () {
    const spy = globals_1.jest.spyOn(console, 'log').mockImplementation(() => { });
    const [A, B] = jsonrpc_1.PairedChannel.create(), local = new jsonrpc_1.JsonRpc(A);
    new jsonrpc_1.JsonRpc(B);
    try {
        yield local.call("test");
    }
    catch (error) {
        (0, globals_1.expect)(error).toBeInstanceOf(jsonrpc_1.JsonRpcError);
        if (error instanceof jsonrpc_1.JsonRpcError) {
            (0, globals_1.expect)(error.code).toEqual(jsonrpc_1.JsonRpcErrorCode.MethodNotFound);
        }
    }
    let resolve;
    let message;
    const promise = new Promise(fn => resolve = fn);
    const handler = (str) => {
        const obj = JSON.parse(str);
        const { error: { code, message } } = obj;
        (0, globals_1.expect)(code).toBe(jsonrpc_1.JsonRpcErrorCode.MethodNotFound);
        resolve();
    };
    A.setHandler(handler);
    local.notify("test");
    yield promise;
    spy.mockRestore();
}));
(0, globals_1.test)("JsonRpc InvalidRequest error", () => __awaiter(void 0, void 0, void 0, function* () {
    const spy = globals_1.jest.spyOn(console, 'error').mockImplementation(() => { });
    const log = globals_1.jest.spyOn(console, 'log').mockImplementation(() => { });
    const [A, B] = jsonrpc_1.PairedChannel.create();
    new jsonrpc_1.JsonRpc(B);
    const resolution = () => {
        let resolve;
        const promise = new Promise(fn => resolve = fn);
        // the extra wrapper around resolve convinces TypeScript that it has 
        // been assigned a value before it's referenced.
        return [promise, (value) => resolve(value)];
    };
    let [promise, resolve] = resolution();
    const handler = globals_1.jest.fn((value) => {
        const obj = JSON.parse(value);
        let { error: { code, message }, id } = obj;
        (0, globals_1.expect)(code).toBe(jsonrpc_1.JsonRpcErrorCode.InvalidRequest);
        (0, globals_1.expect)(id).toBeUndefined();
        (0, globals_1.expect)(message).toBeDefined();
        resolve(undefined);
    });
    A.setHandler(handler);
    // Send the JsonRpc attached to the B side a result without an `id`
    A.send(`{"result": null}`);
    yield promise;
    (0, globals_1.expect)(handler).toBeCalled();
    handler.mockClear();
    [promise, resolve] = resolution();
    // Try sending one with an unmatched `id`
    A.send(`{"result": null, "id": "definitely doesn't exist"}`);
    yield promise;
    (0, globals_1.expect)(handler).toBeCalled();
    handler.mockClear();
    [promise, resolve] = resolution();
    // Here's one without any error, result, or method properties
    A.send('{ "does not matter": "not one bit" }');
    yield promise;
    (0, globals_1.expect)(handler).toBeCalled();
    handler.mockClear();
    [promise, resolve] = resolution();
    // Finally, a JSON parse error
    A.send('{');
    yield promise;
    (0, globals_1.expect)(handler).toBeCalled();
    spy.mockRestore();
    log.mockRestore();
}));
(0, globals_1.test)("JsonRpc InvalidParams error", () => __awaiter(void 0, void 0, void 0, function* () {
    const spy = globals_1.jest.spyOn(console, 'log').mockImplementation(() => { });
    const [A, B] = jsonrpc_1.PairedChannel.create(), remote = new jsonrpc_1.JsonRpc(B);
    const impl = globals_1.jest.fn();
    remote.method("test", impl);
    const handler = globals_1.jest.fn((value) => {
        const obj = JSON.parse(value);
        let { error: { code, message } } = obj;
        (0, globals_1.expect)(code).toBe(jsonrpc_1.JsonRpcErrorCode.InvalidParams);
        (0, globals_1.expect)(message).toBeDefined();
        resolve(undefined);
    });
    A.setHandler(handler);
    const resolution = () => {
        let resolve;
        const promise = new Promise(fn => resolve = fn);
        // the extra wrapper around resolve convinces TypeScript that it has 
        // been assigned a value before it's referenced.
        return [promise, (value) => resolve(value)];
    };
    let [promise, resolve] = resolution();
    A.send(`{"method": "test", "id": 0, "params": "string" }`);
    yield promise;
    (0, globals_1.expect)(handler).toBeCalled();
    (0, globals_1.expect)(impl).not.toBeCalled();
    [promise, resolve] = resolution();
    A.send(`{"method": "test", "params": false }`);
    yield promise;
    (0, globals_1.expect)(handler).toBeCalled();
    (0, globals_1.expect)(impl).not.toBeCalled();
    spy.mockRestore();
}));
(0, globals_1.test)("JsonRpc.incoming() errors from peer", () => __awaiter(void 0, void 0, void 0, function* () {
    const [A, B] = jsonrpc_1.PairedChannel.create();
    new jsonrpc_1.JsonRpc(B);
    const promises = [];
    const defer = (fn) => setTimeout(fn, 0);
    // This is only germane to this file because each test runs in a separate 
    // "thread". Supposedly.
    const spy = globals_1.jest.spyOn(console, 'error').mockImplementation(() => { });
    const log = globals_1.jest.spyOn(console, 'log').mockImplementation(() => { });
    try {
        A.send(`{"error": { "id": "identifiable value" } }`);
        promises.push(new Promise(resolve => {
            defer(() => {
                if (spy.mock.lastCall !== undefined) {
                    (0, globals_1.expect)(spy.mock.lastCall[0]).toMatch(/identifiable value/);
                }
                else {
                    // this will fail if we hit this branch
                    (0, globals_1.expect)(spy.mock.lastCall).toBeDefined();
                }
                resolve();
            });
        }));
        A.send(`{"error": { "doesn't": "matter" }}`);
        promises.push(new Promise(resolve => {
            defer(() => {
                (0, globals_1.expect)(spy).toBeCalled();
                resolve();
            });
        }));
        yield Promise.allSettled(promises);
    }
    finally {
        spy.mockRestore();
        log.mockRestore();
    }
}));
