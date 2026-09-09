// env.ts validates at import time, so these must exist before anything under
// src/ is loaded. vitest runs setupFiles before the test module graph.
process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-to-pass';
process.env.NODE_ENV = 'test';

// Tests run against the MongoDB service already installed on this machine,
// in a throwaway database that is dropped between files. Using the real
// server instead of an in-memory one keeps the suite honest about index
// behaviour - the unique {deviceId, seq} index is the thing under test in
// the ingest specs, and a stub that does not enforce it proves nothing.
process.env.MONGODB_URI =
  process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/lacs_test';
