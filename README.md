# Async JSON-RPC

This module is a TypeScript implementation of JSON-RPC 2.0.

The reasons for this implementation in particular:

 * Simplicity
    - A single class acts as both client and server
    - Remote calls return a Promise allowing async code to treat remote calls like local calls
    - Zero dependencies
    - Small codebase
 * TypeScript implementation
 * Flexible choice of underlying protocol using Channel implementations
 * Channel implementations may be nested allowing a single transport to support multiple modes
 * Support for unit testing RPC with the PairedChannel

The project is not yet mature. Currently the implementation is not spec conforming because it does not return batch results in an array. Additionally, a mature implementation will have timeout exceptions for RPC calls unless explicitly disabled.