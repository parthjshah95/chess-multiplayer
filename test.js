// node test.js
import assert from "node:assert/strict";
import { versionOf } from "./api/game.js";

// versionOf must invert versionPath(id, v) = games/<id>/v<6-digit>.json
assert.equal(versionOf("games/abc/v000001.json"), 1);
assert.equal(versionOf("games/abc/v000042.json"), 42);
assert.equal(versionOf("games/uyPOk57Q-xg/v000123.json"), 123);
assert.equal(versionOf("games/v-id_with-v/v999999.json"), 999999);

// lexicographic pathname order must agree with numeric version order,
// since latestBlob picks the newest by string comparison.
const paths = [1, 2, 9, 10, 99, 100, 999999].map((v) => `games/x/v${String(v).padStart(6, "0")}.json`);
assert.deepEqual([...paths].sort(), paths);

console.log("ok");
