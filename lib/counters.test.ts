import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import { getNextSubmissionNumber } from "./counters";

let testEnv: RulesTestEnvironment;

describe("getNextSubmissionNumber", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-client-counters-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        // This suite tests getNextSubmissionNumber's transaction logic in
        // isolation, not the security rules (those are covered by the
        // "counters rule" tests in tests/firestore-rules.test.ts), so it
        // runs against an open ruleset rather than the real firestore.rules.
        rules: `
          rules_version = '2';
          service cloud.firestore {
            match /databases/{database}/documents {
              match /{document=**} {
                allow read, write: if true;
              }
            }
          }
        `,
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => testEnv?.cleanup());

  it("starts at 001 for a new branch-month key", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const number = await getNextSubmissionNumber(db as unknown as Firestore, "WHO", 2026, 8);
    expect(number).toBe("001/WHO/VIII/2026");
  });

  it("increments on the second call for the same branch-month", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await getNextSubmissionNumber(db as unknown as Firestore, "WHO", 2026, 8);
    const second = await getNextSubmissionNumber(db as unknown as Firestore, "WHO", 2026, 8);
    expect(second).toBe("002/WHO/VIII/2026");
  });

  it("keeps separate counters per branch", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await getNextSubmissionNumber(db as unknown as Firestore, "WHO", 2026, 8);
    const whp = await getNextSubmissionNumber(db as unknown as Firestore, "WHP", 2026, 8);
    expect(whp).toBe("001/WHP/VIII/2026");
  });
});
