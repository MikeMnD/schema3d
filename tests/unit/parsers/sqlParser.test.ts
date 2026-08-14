import { describe, it, expect } from "vitest";
import { parseSqlSchema, identifyValidSqlBlocks } from "@/schemas/parsers";

describe("parseSqlSchema", () => {
  it("should parse a simple CREATE TABLE statement", () => {
    const sql = `
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50),
        email VARCHAR(255)
      );
    `;

    const schema = parseSqlSchema(sql);
    expect(schema).not.toBeNull();
    expect(schema?.tables).toHaveLength(1);
    expect(schema?.tables[0].name).toBe("users");
    expect(schema?.tables[0].columns).toHaveLength(3);
    expect(schema?.tables[0].columns[0].name).toBe("id");
    expect(schema?.tables[0].columns[0].isPrimaryKey).toBe(true);
  });

  it("should parse table-level FOREIGN KEY constraints", () => {
    const sql = `
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        user_id INT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE users (
        id INT PRIMARY KEY
      );
    `;

    const schema = parseSqlSchema(sql);
    expect(schema).not.toBeNull();
    const ordersTable = schema?.tables.find((t) => t.name === "orders");
    expect(ordersTable).toBeDefined();
    const userIdColumn = ordersTable?.columns.find((c) => c.name === "user_id");
    expect(userIdColumn?.isForeignKey).toBe(true);
    expect(userIdColumn?.references?.table).toBe("users");
    expect(userIdColumn?.references?.column).toBe("id");
  });

  it("should parse column-level FOREIGN KEY constraints", () => {
    const sql = `
      CREATE TABLE users (
        id INT PRIMARY KEY
      );
      CREATE TABLE posts (
        id INT PRIMARY KEY,
        user_id INT REFERENCES users(id)
      );
    `;

    const schema = parseSqlSchema(sql);
    expect(schema).not.toBeNull();
    const postsTable = schema?.tables.find((t) => t.name === "posts");
    expect(postsTable).toBeDefined();
    const userIdColumn = postsTable?.columns.find((c) => c.name === "user_id");
    expect(userIdColumn?.isForeignKey).toBe(true);
    expect(userIdColumn?.references?.table).toBe("users");
  });

  it("should parse T-SQL bracketed identifiers", () => {
    const sql = `
      CREATE TABLE [Users] (
        [Id] INT PRIMARY KEY,
        [UserName] VARCHAR(50)
      );
    `;

    const schema = parseSqlSchema(sql);
    expect(schema).not.toBeNull();
    expect(schema?.tables[0].name).toBe("Users");
    expect(schema?.tables[0].columns[0].name).toBe("Id");
  });

  it("should parse ALTER TABLE ADD statements", () => {
    const sql = `
      CREATE TABLE users (
        id INT PRIMARY KEY
      );
      ALTER TABLE users ADD email VARCHAR(255);
    `;

    const schema = parseSqlSchema(sql);
    expect(schema).not.toBeNull();
    const usersTable = schema?.tables.find((t) => t.name === "users");
    expect(usersTable?.columns).toHaveLength(2);
    expect(usersTable?.columns.some((c) => c.name === "email")).toBe(true);
  });

  it("should parse UNIQUE constraints", () => {
    const sql = `
      CREATE TABLE users (
        id INT PRIMARY KEY,
        email VARCHAR(255) UNIQUE,
        username VARCHAR(50) UNIQUE
      );
    `;

    const schema = parseSqlSchema(sql);
    expect(schema).not.toBeNull();
    const emailColumn = schema?.tables[0].columns.find(
      (c) => c.name === "email"
    );
    const usernameColumn = schema?.tables[0].columns.find(
      (c) => c.name === "username"
    );
    expect(emailColumn?.isUnique).toBe(true);
    expect(usernameColumn?.isUnique).toBe(true);
  });

  it("should detect NOT NULL constraints", () => {
    const sql = `
      CREATE TABLE users (
        id INT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        username VARCHAR(50),
        phone VARCHAR(20) NULL
      );
    `;

    const schema = parseSqlSchema(sql);
    expect(schema).not.toBeNull();
    const emailColumn = schema?.tables[0].columns.find(
      (c) => c.name === "email"
    );
    const usernameColumn = schema?.tables[0].columns.find(
      (c) => c.name === "username"
    );
    const phoneColumn = schema?.tables[0].columns.find(
      (c) => c.name === "phone"
    );
    const idColumn = schema?.tables[0].columns.find((c) => c.name === "id");

    // NOT NULL should be false
    expect(emailColumn?.isNullable).toBe(false);
    // Primary keys are implicitly NOT NULL
    expect(idColumn?.isNullable).toBe(false);
    // No constraint specified should be undefined (defaults to nullable)
    expect(usernameColumn?.isNullable).toBeUndefined();
    // Explicit NULL should be true
    expect(phoneColumn?.isNullable).toBe(true);
  });

  it("should use NULL/NOT NULL for cardinality calculation in foreign keys", () => {
    const sql = `
      CREATE TABLE users (
        id INT PRIMARY KEY
      );
      CREATE TABLE posts (
        id INT PRIMARY KEY,
        user_id_nullable INT REFERENCES users(id),
        user_id_not_null INT NOT NULL REFERENCES users(id)
      );
    `;

    const schema = parseSqlSchema(sql);
    expect(schema).not.toBeNull();
    const postsTable = schema?.tables.find((t) => t.name === "posts");
    const nullableFk = postsTable?.columns.find(
      (c) => c.name === "user_id_nullable"
    );
    const notNullFk = postsTable?.columns.find(
      (c) => c.name === "user_id_not_null"
    );

    expect(nullableFk?.isNullable).toBeUndefined(); // Defaults to nullable
    expect(notNullFk?.isNullable).toBe(false); // NOT NULL
  });

  it("should return null for invalid SQL", () => {
    const sql = "INVALID SQL STATEMENT";
    const schema = parseSqlSchema(sql);
    expect(schema).toBeNull();
  });

  it("should handle empty input", () => {
    const schema = parseSqlSchema("");
    expect(schema).toBeNull();
  });

  it("should parse multiple tables with relationships", () => {
    const sql = `
      CREATE TABLE users (
        id INT PRIMARY KEY,
        name VARCHAR(100)
      );
      CREATE TABLE posts (
        id INT PRIMARY KEY,
        user_id INT REFERENCES users(id),
        title VARCHAR(200)
      );
      CREATE TABLE comments (
        id INT PRIMARY KEY,
        post_id INT REFERENCES posts(id),
        content TEXT
      );
    `;

    const schema = parseSqlSchema(sql);
    expect(schema).not.toBeNull();
    expect(schema?.tables).toHaveLength(3);

    const postsTable = schema?.tables.find((t) => t.name === "posts");
    expect(
      postsTable?.columns.find((c) => c.name === "user_id")?.isForeignKey
    ).toBe(true);

    const commentsTable = schema?.tables.find((t) => t.name === "comments");
    expect(
      commentsTable?.columns.find((c) => c.name === "post_id")?.isForeignKey
    ).toBe(true);
  });
});

describe("identifyValidSqlBlocks", () => {
  it("should identify valid SQL blocks", () => {
    const sql = "CREATE TABLE users (id INT PRIMARY KEY);";
    const blocks = identifyValidSqlBlocks(sql);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.isValid)).toBe(true);
  });

  it("should mark invalid SQL as invalid", () => {
    const sql = "INVALID SQL STATEMENT";
    const blocks = identifyValidSqlBlocks(sql);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => !b.isValid)).toBe(true);
  });

  it("should handle mixed valid and invalid SQL", () => {
    const sql = "CREATE TABLE users (id INT); INVALID STATEMENT";
    const blocks = identifyValidSqlBlocks(sql);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.isValid)).toBe(true);
    expect(blocks.some((b) => !b.isValid)).toBe(true);
  });
});

describe("parseSqlSchema - pg_dump format", () => {
  const pgDumpSql = `
--
-- PostgreSQL database dump
--

SET statement_timeout = 0;

CREATE TABLE public."AbpUsers" (
    "Id" bigint DEFAULT nextval('public."AbpUsers_Id_seq"'::regclass) NOT NULL,
    "UserName" character varying(256) NOT NULL,
    "EmailAddress" character varying(256),
    "TenantId" integer
);

CREATE TABLE public."AbpTenants" (
    "Id" integer NOT NULL,
    "TenancyName" character varying(64) NOT NULL
);

CREATE TABLE public."AbpUserRoles" (
    "UserId" bigint NOT NULL,
    "RoleId" integer NOT NULL
);

ALTER TABLE ONLY public."AbpUsers"
    ADD CONSTRAINT "PK_AbpUsers" PRIMARY KEY ("Id");

ALTER TABLE ONLY public."AbpTenants"
    ADD CONSTRAINT "PK_AbpTenants" PRIMARY KEY ("Id");

ALTER TABLE ONLY public."AbpUserRoles"
    ADD CONSTRAINT "PK_AbpUserRoles" PRIMARY KEY ("UserId", "RoleId");

ALTER TABLE ONLY public."AbpTenants"
    ADD CONSTRAINT "UQ_AbpTenants_TenancyName" UNIQUE ("TenancyName");

ALTER TABLE ONLY public."AbpUsers"
    ADD CONSTRAINT "FK_AbpUsers_AbpTenants_TenantId_With_A_Very_Long_Name_Trunca~" FOREIGN KEY ("TenantId") REFERENCES public."AbpTenants"("Id") ON DELETE CASCADE;

ALTER TABLE ONLY public."AbpUserRoles"
    ADD CONSTRAINT "FK_AbpUserRoles_AbpUsers_UserId" FOREIGN KEY ("UserId") REFERENCES public."AbpUsers"("Id");
`;

  it("should parse CREATE TABLE with quoted schema-qualified names", () => {
    const schema = parseSqlSchema(pgDumpSql);
    expect(schema).not.toBeNull();
    expect(schema?.tables.map((t) => t.name).sort()).toEqual([
      "AbpTenants",
      "AbpUserRoles",
      "AbpUsers",
    ]);
    const users = schema?.tables.find((t) => t.name === "AbpUsers");
    expect(users?.columns.map((c) => c.name)).toEqual([
      "Id",
      "UserName",
      "EmailAddress",
      "TenantId",
    ]);
  });

  it("should apply PRIMARY KEY from ALTER TABLE ONLY ... ADD CONSTRAINT", () => {
    const schema = parseSqlSchema(pgDumpSql);
    const users = schema?.tables.find((t) => t.name === "AbpUsers");
    expect(users?.columns.find((c) => c.name === "Id")?.isPrimaryKey).toBe(
      true
    );
  });

  it("should apply composite PRIMARY KEY constraints to all columns", () => {
    const schema = parseSqlSchema(pgDumpSql);
    const userRoles = schema?.tables.find((t) => t.name === "AbpUserRoles");
    expect(
      userRoles?.columns.find((c) => c.name === "UserId")?.isPrimaryKey
    ).toBe(true);
    expect(
      userRoles?.columns.find((c) => c.name === "RoleId")?.isPrimaryKey
    ).toBe(true);
  });

  it("should apply FOREIGN KEY from ALTER TABLE ONLY, including truncated ~ constraint names and ON DELETE clauses", () => {
    const schema = parseSqlSchema(pgDumpSql);
    const users = schema?.tables.find((t) => t.name === "AbpUsers");
    const tenantId = users?.columns.find((c) => c.name === "TenantId");
    expect(tenantId?.isForeignKey).toBe(true);
    expect(tenantId?.references?.table).toBe("AbpTenants");
    expect(tenantId?.references?.column).toBe("Id");

    const userRoles = schema?.tables.find((t) => t.name === "AbpUserRoles");
    const userId = userRoles?.columns.find((c) => c.name === "UserId");
    expect(userId?.isForeignKey).toBe(true);
    expect(userId?.references?.table).toBe("AbpUsers");
  });

  it("should apply UNIQUE from ALTER TABLE ONLY ... ADD CONSTRAINT", () => {
    const schema = parseSqlSchema(pgDumpSql);
    const tenants = schema?.tables.find((t) => t.name === "AbpTenants");
    expect(
      tenants?.columns.find((c) => c.name === "TenancyName")?.isUnique
    ).toBe(true);
  });
});
