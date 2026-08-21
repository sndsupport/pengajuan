import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";

let testEnv: RulesTestEnvironment;

describe("firestore.rules", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-rules-test",
      firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
    });
    await testEnv.clearFirestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("users").doc("uid-admin").set({ role: "admin_cabang", branch: "WHO" });
      await db.collection("users").doc("uid-snd").set({ role: "snd", branch: "SND" });
      await db.collection("users").doc("uid-spv").set({ role: "spv", branch: "WHO" });
      await db.collection("submissions").doc("sub-1").set({ requesterId: "uid-admin", status: "diajukan" });
    });
  });

  afterAll(() => testEnv?.cleanup());

  it("denies unauthenticated read of a submission", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.collection("submissions").doc("sub-1").get());
  });

  it("allows the owner to read their own submission", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertSucceeds(db.collection("submissions").doc("sub-1").get());
  });

  it("allows spv to read any submission", async () => {
    const db = testEnv.authenticatedContext("uid-spv").firestore();
    await assertSucceeds(db.collection("submissions").doc("sub-1").get());
  });

  it("denies a non-owner, non-reviewer read", async () => {
    const db = testEnv.authenticatedContext("uid-snd").firestore();
    await assertFails(db.collection("submissions").doc("sub-1").get());
  });

  it("denies direct client update of submission status", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(db.collection("submissions").doc("sub-1").update({ status: "disetujui" }));
  });

  it("denies direct client write to statusHistory", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(
      db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h1").set({ status: "diajukan" })
    );
  });

  it("denies direct client write to counters", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(db.collection("counters").doc("WHO-2026-08").set({ lastNumber: 1 }));
  });
});
