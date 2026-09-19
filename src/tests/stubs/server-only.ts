// Stands in for the `server-only` marker package under test. Importing the real
// one throws; Next itself swaps in an empty module on the server, and this
// mirrors that so server modules can be exercised directly.
export {};
