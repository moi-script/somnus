import { describe, expect, it } from 'vitest';
import { redactedMongoUri } from '../src/env.js';

describe('redactedMongoUri', () => {
  it('hides the credentials of a hosted database', () => {
    expect(redactedMongoUri('mongodb+srv://somnus:s3cret-Pa55@cluster0.ab1cd.mongodb.net/lacs')).toBe(
      'mongodb+srv://***@cluster0.ab1cd.mongodb.net/lacs',
    );
  });

  it('leaves a local address without credentials alone', () => {
    expect(redactedMongoUri('mongodb://127.0.0.1:27017/lacs')).toBe('mongodb://127.0.0.1:27017/lacs');
  });
});
