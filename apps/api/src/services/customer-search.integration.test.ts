// Customer search matches the name, the phone number and the address.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("customer search", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(() => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, code, name, phone, address, branch_id, created_at) VALUES
        ('c1','CUS-1','Nimal Perera','0771111111','12 Galle Road, Colombo 03','b1',1),
        ('c2','CUS-2','Kamala Silva','0712222222','45 Kandy Street, Peradeniya','b1',2),
        ('c3','CUS-3','Fahim','0763333333',NULL,'b1',3);
    `);
  });

  const names = async (search: string) => {
    const { listParties } = await import("./parties");
    const r = await listParties(db, "customers", "u1", true, { page: 1, limit: 20, search });
    return r.rows.map((x) => x.name).sort();
  };

  it("finds a customer by name", async () => {
    expect(await names("Kamala")).toEqual(["Kamala Silva"]);
  });

  it("finds a customer by phone number", async () => {
    expect(await names("0763333")).toEqual(["Fahim"]);
  });

  it("finds a customer by address", async () => {
    expect(await names("Galle Road")).toEqual(["Nimal Perera"]);
    expect(await names("Peradeniya")).toEqual(["Kamala Silva"]);
  });

  it("returns everyone for an empty search", async () => {
    expect(await names("")).toEqual(["Fahim", "Kamala Silva", "Nimal Perera"]);
  });
});
