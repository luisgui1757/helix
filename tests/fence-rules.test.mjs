import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCommand, classifyWritePath } from "../extensions/lib/fence-rules.mjs";

test("classifyCommand flags irreversible / high-blast-radius commands", () => {
  const risky = {
    "rm -rf /tmp/x": "rm-recursive",
    "rm -fr build": "rm-recursive",
    "git push --force origin main": "git-push-force",
    "git push -f": "git-push-force",
    "git reset --hard HEAD~3": "git-reset-hard",
    "git clean -fd": "git-clean-force",
    "git branch -D feature": "git-branch-delete",
    "sudo rm /etc/hosts": "sudo",
    "chmod 777 secret": "chmod-chown-777",
    "chown -R root:root /": "chmod-chown-recursive",
    "dd if=/dev/zero of=/dev/sda": "dd-disk",
    "drop database prod": "db-drop",
    "kubectl delete pod api": "kubectl-delete",
    "terraform destroy": "terraform-destroy",
    "docker system prune -af": "docker-system-prune",
  };
  for (const [cmd, rule] of Object.entries(risky)) {
    const r = classifyCommand(cmd);
    assert.equal(r.risky, true, `expected risky: ${cmd}`);
    assert.equal(r.rule, rule, `expected rule ${rule} for: ${cmd}`);
  }
});

test("classifyCommand allows safe commands", () => {
  const safe = [
    "ls -la",
    "git status",
    "git push origin main",
    "git push --force-with-lease origin main",
    "npm test",
    "npm run check:resources",
    "chmod 644 file.txt",
    "cat README.md",
  ];
  for (const cmd of safe) {
    assert.equal(classifyCommand(cmd).risky, false, `expected safe: ${cmd}`);
  }
});

test("classifyCommand handles empty / non-string input", () => {
  assert.equal(classifyCommand("").risky, false);
  assert.equal(classifyCommand(undefined).risky, false);
  assert.equal(classifyCommand(null).risky, false);
});

test("classifyWritePath protects secret and VCS-internal paths", () => {
  const prot = {
    ".env": "dotenv",
    "app/.env.local": "dotenv",
    "auth.json": "auth-json",
    ["/" + "home/u/.ssh/config"]: "ssh-dir",
    "keys/id_ed25519": "private-key",
    ".git/config": "git-internal",
    "secrets.json": "credentials",
    ".netrc": "netrc",
  };
  for (const [p, rule] of Object.entries(prot)) {
    const r = classifyWritePath(p);
    assert.equal(r.protectedPath, true, `expected protected: ${p}`);
    assert.equal(r.rule, rule, `expected rule ${rule} for: ${p}`);
  }
});

test("classifyWritePath allows normal project files", () => {
  const ok = [
    "src/index.ts",
    "README.md",
    ".pi/settings.json",
    "docs/environment.md",
    "extensions/helix-fence.ts",
  ];
  for (const p of ok) {
    assert.equal(classifyWritePath(p).protectedPath, false, `expected allowed: ${p}`);
  }
  assert.equal(classifyWritePath("").protectedPath, false);
});
