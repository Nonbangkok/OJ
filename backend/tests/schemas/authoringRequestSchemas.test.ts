import { AUTHORING_VALIDATION } from '../../constants';
import {
  createAuthorProfileSchema,
  createProblemDraftSchema,
  problemDraftIdParamSchema,
  updateAuthorProfileSchema,
  updateProblemDraftSchema,
} from '../../schemas/requestSchemas';

const validCreateBody = {
  problemId: 'redgate',
  title: 'Red Gate',
  authorProfileId: null,
  authorAkaName: 'Author',
  authorRealName: 'Example Author',
  language: 'Thai',
  countryCode: 'THA',
  timeLimitMs: 1000,
  memoryLimitMb: 256,
};

describe('problem authoring request schemas', () => {
  it('normalizes a valid create body and supplies source defaults', () => {
    const result = createProblemDraftSchema.parse({
      ...validCreateBody,
      title: '  Red Gate  ',
    });

    expect(result).toEqual({
      ...validCreateBody,
      title: 'Red Gate',
      statementHtml: '',
      solutionCpp: '',
      generatorCpp: null,
      templateVersion: 'red-gate-v1',
    });
  });

  it('rejects invalid identifiers, country codes, and resource limits', () => {
    expect(createProblemDraftSchema.safeParse({ ...validCreateBody, problemId: 'x'.repeat(51) }).success)
      .toBe(false);
    expect(createProblemDraftSchema.safeParse({ ...validCreateBody, countryCode: 'th' }).success)
      .toBe(false);
    expect(createProblemDraftSchema.safeParse({ ...validCreateBody, timeLimitMs: 0 }).success)
      .toBe(false);
    expect(createProblemDraftSchema.safeParse({ ...validCreateBody, memoryLimitMb: 0 }).success)
      .toBe(false);
  });

  it('enforces the statement and C++ limits in UTF-8 bytes', () => {
    const tooLargeAscii = 'a'.repeat(AUTHORING_VALIDATION.MAX_SOURCE_BYTES + 1);
    const tooLargeThai = 'ก'.repeat(Math.floor(AUTHORING_VALIDATION.MAX_SOURCE_BYTES / 3) + 1);

    expect(createProblemDraftSchema.safeParse({
      ...validCreateBody,
      statementHtml: tooLargeThai,
    }).success).toBe(false);
    expect(createProblemDraftSchema.safeParse({
      ...validCreateBody,
      solutionCpp: tooLargeAscii,
    }).success).toBe(false);
    expect(createProblemDraftSchema.safeParse({
      ...validCreateBody,
      generatorCpp: tooLargeAscii,
    }).success).toBe(false);
  });

  it('requires a positive expectedRevision and at least one changed field', () => {
    expect(updateProblemDraftSchema.safeParse({ expectedRevision: 2, title: 'New title' }).success)
      .toBe(true);
    expect(updateProblemDraftSchema.safeParse({ title: 'New title' }).success)
      .toBe(false);
    expect(updateProblemDraftSchema.safeParse({ expectedRevision: 0, title: 'New title' }).success)
      .toBe(false);
    expect(updateProblemDraftSchema.safeParse({ expectedRevision: 2 }).success)
      .toBe(false);
  });

  it('accepts explicit generator removal and rejects unknown update fields', () => {
    expect(updateProblemDraftSchema.safeParse({
      expectedRevision: 2,
      generatorCpp: null,
    }).success).toBe(true);
    expect(updateProblemDraftSchema.safeParse({
      expectedRevision: 2,
      status: 'published',
    }).success).toBe(false);
  });

  it('requires a UUID draft route parameter', () => {
    expect(problemDraftIdParamSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
    }).success).toBe(true);
    expect(problemDraftIdParamSchema.safeParse({ id: 'redgate' }).success).toBe(false);
  });
});

describe('author profile request schemas', () => {
  const validProfile = {
    userId: null,
    akaName: 'Nonbangkok',
    realName: 'Example Author',
    defaultLanguage: 'Thai',
    countryCode: 'THA',
  };

  it('accepts JSON profile metadata and converts multipart numeric fields', () => {
    expect(createAuthorProfileSchema.parse(validProfile)).toEqual(validProfile);
    expect(createAuthorProfileSchema.parse({ ...validProfile, userId: '7' })).toEqual({
      ...validProfile,
      userId: 7,
    });
  });

  it('rejects invalid profile metadata', () => {
    expect(createAuthorProfileSchema.safeParse({
      ...validProfile,
      akaName: ' ',
    }).success).toBe(false);
    expect(createAuthorProfileSchema.safeParse({
      ...validProfile,
      countryCode: 'th',
    }).success).toBe(false);
    expect(createAuthorProfileSchema.safeParse({
      ...validProfile,
      userId: 'not-a-number',
    }).success).toBe(false);
  });

  it('parses multipart removal flags without treating "false" as true', () => {
    expect(updateAuthorProfileSchema.parse({ removeProfileImage: 'true' }))
      .toEqual({ removeProfileImage: true });
    expect(updateAuthorProfileSchema.parse({ removeProfileImage: 'false' }))
      .toEqual({ removeProfileImage: false });
  });
});
