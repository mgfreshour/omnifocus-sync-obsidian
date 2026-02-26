import type { Phase1Assignment } from './smart-sort';
import {
  closeTruncatedArray,
  parsePhase1Response,
  parsePhase2Response,
  relaxJson,
} from './smart-sort';

describe('relaxJson', () => {
  it('removes trailing comma before ]', () => {
    expect(relaxJson('[1, 2, ]')).toBe('[1, 2]');
    expect(relaxJson('[1, 2,]')).toBe('[1, 2]');
  });

  it('removes trailing comma before }', () => {
    expect(relaxJson('{"a":1,}')).toBe('{"a":1}');
  });

  it('leaves valid JSON unchanged when no trailing commas', () => {
    expect(relaxJson('[1,2,3]')).toBe('[1,2,3]');
  });
});

describe('closeTruncatedArray', () => {
  it('closes array that starts with [ but does not end with ]', () => {
    expect(closeTruncatedArray('[1,2')).toBe('[1,2]');
  });

  it('strips trailing comma before adding ]', () => {
    expect(closeTruncatedArray('[1,2,')).toBe('[1,2]');
  });

  it('leaves already closed array unchanged', () => {
    expect(closeTruncatedArray('[1,2]')).toBe('[1,2]');
  });

  it('leaves non-array string unchanged', () => {
    expect(closeTruncatedArray('not an array')).toBe('not an array');
  });
});

describe('parsePhase1Response', () => {
  it('parses array of objects with project and reasoning', () => {
    const content = '[{"project":1,"reasoning":"Fits A"},{"project":0,"reasoning":"No fit"}]';
    const result = parsePhase1Response(content, 2, 3);
    expect(result).toEqual([
      { project: 1, reasoning: 'Fits A' },
      { project: 0, reasoning: 'No fit' },
    ] as Phase1Assignment[]);
  });

  it('strips markdown code fence and parses', () => {
    const content = '```json\n[{"project":1,"reasoning":""}]\n```';
    const result = parsePhase1Response(content, 1, 2);
    expect(result).toEqual([{ project: 1 }]);
  });

  it('relaxes trailing comma and parses', () => {
    const content = '[{"project":1},]';
    const result = parsePhase1Response(content, 1, 1);
    expect(result).toEqual([{ project: 1 }]);
  });

  it('returns null when array length does not match tasksLen', () => {
    const content = '[{"project":1}]';
    expect(parsePhase1Response(content, 2, 1)).toBeNull();
  });

  it('returns null when project index out of range', () => {
    const content = '[{"project":5}]'; // projectsLen is 2, so valid indices are 0,1,2
    expect(parsePhase1Response(content, 1, 2)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parsePhase1Response('not json', 1, 1)).toBeNull();
  });
});

describe('parsePhase2Response', () => {
  it('parses array of objects with task, suggestion, type', () => {
    const content =
      '[{"task":"T1","suggestion":"Proj A","type":"project"},{"task":"T2","suggestion":"Area B","type":"area"}]';
    const result = parsePhase2Response(content);
    expect(result).toEqual([
      { task: 'T1', suggestion: 'Proj A', type: 'project' },
      { task: 'T2', suggestion: 'Area B', type: 'area' },
    ]);
  });

  it('returns null when not an array', () => {
    expect(parsePhase2Response('{"task":"x","suggestion":"y"}')).toBeNull();
  });

  it('returns null when entry missing task or suggestion', () => {
    expect(parsePhase2Response('[{"suggestion":"y","type":"project"}]')).toBeNull();
    expect(parsePhase2Response('[{"task":"x","type":"project"}]')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parsePhase2Response('not json')).toBeNull();
  });
});
