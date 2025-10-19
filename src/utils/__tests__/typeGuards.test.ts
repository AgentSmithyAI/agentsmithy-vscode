import {
    asString,
    getErrorMessage,
    hasMessage,
    isBoolean,
    isError,
    isNumber,
    isRecord,
    safeJsonParse,
} from '../typeGuards';

describe('typeGuards', () => {
  describe('isRecord', () => {
    it('returns true for plain objects', () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({a: 1})).toBe(true);
      expect(isRecord({a: 1, b: 'test'})).toBe(true);
    });

    it('returns false for non-objects', () => {
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord(123)).toBe(false);
      expect(isRecord('string')).toBe(false);
      expect(isRecord(true)).toBe(false);
    });

    it('returns false for arrays', () => {
      expect(isRecord([])).toBe(false);
      expect(isRecord([1, 2, 3])).toBe(false);
    });
  });

  describe('asString', () => {
    it('returns string for string values', () => {
      expect(asString('test')).toBe('test');
      expect(asString('')).toBe('');
      expect(asString('hello world')).toBe('hello world');
    });

    it('returns undefined for non-string values', () => {
      expect(asString(123)).toBeUndefined();
      expect(asString(null)).toBeUndefined();
      expect(asString(undefined)).toBeUndefined();
      expect(asString({})).toBeUndefined();
      expect(asString([])).toBeUndefined();
      expect(asString(true)).toBeUndefined();
    });
  });

  describe('isError', () => {
    it('returns true for Error instances', () => {
      expect(isError(new Error('test'))).toBe(true);
      expect(isError(new TypeError('test'))).toBe(true);
      expect(isError(new RangeError('test'))).toBe(true);
    });

    it('returns false for non-Error values', () => {
      expect(isError({message: 'test'})).toBe(false);
      expect(isError('error')).toBe(false);
      expect(isError(null)).toBe(false);
      expect(isError(undefined)).toBe(false);
    });
  });

  describe('hasMessage', () => {
    it('returns true for objects with string message property', () => {
      expect(hasMessage({message: 'test'})).toBe(true);
      expect(hasMessage({message: 'hello', other: 123})).toBe(true);
    });

    it('returns false for objects without message property', () => {
      expect(hasMessage({})).toBe(false);
      expect(hasMessage({msg: 'test'})).toBe(false);
    });

    it('returns false for objects with non-string message', () => {
      expect(hasMessage({message: 123})).toBe(false);
      expect(hasMessage({message: null})).toBe(false);
      expect(hasMessage({message: undefined})).toBe(false);
    });

    it('returns false for non-objects', () => {
      expect(hasMessage(null)).toBe(false);
      expect(hasMessage(undefined)).toBe(false);
      expect(hasMessage('test')).toBe(false);
      expect(hasMessage(123)).toBe(false);
    });
  });

  describe('getErrorMessage', () => {
    it('extracts message from Error instances', () => {
      expect(getErrorMessage(new Error('test error'), 'fallback')).toBe('test error');
      expect(getErrorMessage(new TypeError('type error'), 'fallback')).toBe('type error');
    });

    it('extracts message from objects with message property', () => {
      expect(getErrorMessage({message: 'custom error'}, 'fallback')).toBe('custom error');
    });

    it('returns fallback for values without message', () => {
      expect(getErrorMessage('error string', 'fallback')).toBe('fallback');
      expect(getErrorMessage(123, 'fallback')).toBe('fallback');
      expect(getErrorMessage(null, 'fallback')).toBe('fallback');
      expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
      expect(getErrorMessage({}, 'fallback')).toBe('fallback');
    });
  });

  describe('isBoolean', () => {
    it('returns true for boolean values', () => {
      expect(isBoolean(true)).toBe(true);
      expect(isBoolean(false)).toBe(true);
    });

    it('returns false for non-boolean values', () => {
      expect(isBoolean(1)).toBe(false);
      expect(isBoolean(0)).toBe(false);
      expect(isBoolean('true')).toBe(false);
      expect(isBoolean(null)).toBe(false);
      expect(isBoolean(undefined)).toBe(false);
      expect(isBoolean({})).toBe(false);
    });
  });

  describe('isNumber', () => {
    it('returns true for number values', () => {
      expect(isNumber(0)).toBe(true);
      expect(isNumber(123)).toBe(true);
      expect(isNumber(-456)).toBe(true);
      expect(isNumber(3.14)).toBe(true);
      expect(isNumber(Number.NaN)).toBe(true);
      expect(isNumber(Number.POSITIVE_INFINITY)).toBe(true);
    });

    it('returns false for non-number values', () => {
      expect(isNumber('123')).toBe(false);
      expect(isNumber(null)).toBe(false);
      expect(isNumber(undefined)).toBe(false);
      expect(isNumber({})).toBe(false);
      expect(isNumber([])).toBe(false);
    });
  });

  describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
      expect(safeJsonParse('{"a":1}')).toEqual({a: 1});
      expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
      expect(safeJsonParse('"string"')).toBe('string');
      expect(safeJsonParse('123')).toBe(123);
      expect(safeJsonParse('true')).toBe(true);
      expect(safeJsonParse('null')).toBe(null);
    });

    it('returns undefined for invalid JSON', () => {
      expect(safeJsonParse('invalid')).toBeUndefined();
      expect(safeJsonParse('{"incomplete"')).toBeUndefined();
      expect(safeJsonParse('')).toBeUndefined();
      expect(safeJsonParse('undefined')).toBeUndefined();
    });

    it('works with type parameter', () => {
      interface User {
        name: string;
        age: number;
      }
      const result = safeJsonParse<User>('{"name":"John","age":30}');
      expect(result).toEqual({name: 'John', age: 30});
    });
  });
});

