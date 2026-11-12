import { describe, expect, it } from "vitest";
import { isLocalDatabaseUrl } from "./db";

// The guard that keeps the race tests (they write and commit) away from any database that is not
// this machine. It does not need the database.

describe("isLocalDatabaseUrl", () => {
  it.each([
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    "postgresql://postgres:postgres@localhost:54322/postgres",
    "postgres://postgres:postgres@[::1]:54322/postgres",
    "postgresql://postgres:postgres@localhost/postgres?host=127.0.0.1",
    "postgresql://postgres:postgres@/postgres?host=/var/run/postgresql",
  ])("accepts %s", (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
  });

  it.each([
    "postgresql://postgres:postgres@localhost:54322/postgres?host=db.remota.example",
    "postgresql://postgres:postgres@127.0.0.1/postgres?host=db.remota.example",
    "postgresql://postgres:postgres@localhost/postgres?hostaddr=203.0.113.7",
    "postgresql://postgres:postgres@localhost/postgres?service=remota",
    "postgresql://postgres:postgres@db.remota.example:5432/postgres",
    "postgresql://postgres:postgres@localhost.remota.example/postgres",
    "postgresql://postgres:postgres@a.example,localhost/postgres",
    "http://localhost:54322/postgres",
    "postgresql://postgres:postgres@/postgres",
    "no es una url",
    "",
  ])("rejects %s", (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(false);
  });
});
