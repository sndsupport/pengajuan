import { describe, it, expect, beforeEach } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getNextSubmissionNumber } from "./counters";

let testEnv: RulesTestEnvironment;

describe("getNextSubmissionNumber", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-counters-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  it("starts at 001 for a new branch-month key", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const number = await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    expect(number).toBe("001/WHO/VIII/2026");
  });

  it("increments on the second call for the same branch-month", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    const second = await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    expect(second).toBe("002/WHO/VIII/2026");
  });

  it("keeps separate counters per branch", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await getNextSubmissionNumber(db as any, "WHO", 2026, 8);
    const whp = await getNextSubmissionNumber(db as any, "WHP", 2026, 8);
    expect(whp).toBe("001/WHP/VIII/2026");
  });
});
