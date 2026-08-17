import { parseSqlSchema } from "../parsers/sql-parser";
import { parseMermaidSchema } from "../parsers/mermaid-parser";
import type { DatabaseSchema } from "@/shared/types/schema";

// Import SQL files as raw text
import retailerSql from "../sample-schemas/retailer.sql?raw";
import blogPlatformSql from "../sample-schemas/blog-platform.sql?raw";

// Import Mermaid files as raw text
import universityMermaid from "../sample-schemas/university.mmd?raw";

// Cosher production structure dump. The file is gitignored (it describes a
// private production database), so it is loaded via a glob that tolerates
// its absence — checkouts without the file (CI, other contributors) build
// and fall back to the demo schemas. Regenerate it with pg_dump
// --schema-only from the crm_db_dev_instance container and save it as
// client/src/schemas/sample-schemas/cosher.sql
const cosherFiles = import.meta.glob("../sample-schemas/cosher.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const cosherSql: string | null = Object.values(cosherFiles)[0] ?? null;

// Cache parsed schemas
let retailerSchemaCache: DatabaseSchema | null = null;
let blogPlatformSchemaCache: DatabaseSchema | null = null;
let universitySchemaCache: DatabaseSchema | null = null;
let cosherSchemaCache: DatabaseSchema | null = null;

// Store original text for each schema
export const RETAILER_SQL = retailerSql;
export const BLOG_PLATFORM_SQL = blogPlatformSql;
export const UNIVERSITY_MERMAID = universityMermaid;
export const COSHER_SQL = cosherSql;

export function getCosherSchema(): DatabaseSchema | null {
  if (!cosherSql) {
    return null;
  }
  if (!cosherSchemaCache) {
    const parsed = parseSqlSchema(cosherSql);
    if (!parsed) {
      throw new Error("Failed to parse Cosher schema");
    }
    cosherSchemaCache = {
      ...parsed,
      name: "Cosher DB",
    };
  }
  return cosherSchemaCache;
}

export function getRetailerSchema(): DatabaseSchema {
  if (!retailerSchemaCache) {
    const parsed = parseSqlSchema(retailerSql);
    if (!parsed) {
      throw new Error("Failed to parse retailer schema");
    }
    retailerSchemaCache = {
      ...parsed,
      name: "Retailer",
    };
  }
  return retailerSchemaCache;
}

export function getBlogPlatformSchema(): DatabaseSchema {
  if (!blogPlatformSchemaCache) {
    const parsed = parseSqlSchema(blogPlatformSql);
    if (!parsed) {
      throw new Error("Failed to parse blog platform schema");
    }
    blogPlatformSchemaCache = {
      ...parsed,
      name: "Blog Platform",
    };
  }
  return blogPlatformSchemaCache;
}

export function getUniversitySchema(): DatabaseSchema {
  if (!universitySchemaCache) {
    const parsed = parseMermaidSchema(universityMermaid);
    if (!parsed) {
      throw new Error("Failed to parse university schema");
    }
    universitySchemaCache = {
      ...parsed,
      name: "University",
    };
  }
  return universitySchemaCache;
}

export function getSampleSchemas(): DatabaseSchema[] {
  const cosherSchema = getCosherSchema();
  if (cosherSchema) {
    return [
      cosherSchema,
      // Demo schemas hidden while working with the Cosher DB — re-enable
      // by uncommenting:
      // getRetailerSchema(),
      // getBlogPlatformSchema(),
      // getUniversitySchema(),
    ];
  }
  // Without the (gitignored) Cosher dump, fall back to the demo schemas
  return [getRetailerSchema(), getBlogPlatformSchema(), getUniversitySchema()];
}

// Get the original text for a schema by name
export function getSchemaText(schemaName: string): string | null {
  if (schemaName === "Cosher DB") {
    return COSHER_SQL;
  } else if (schemaName === "Retailer") {
    return RETAILER_SQL;
  } else if (schemaName === "Blog Platform") {
    return BLOG_PLATFORM_SQL;
  } else if (schemaName === "University") {
    return UNIVERSITY_MERMAID;
  }
  return null;
}

// Get the format (sql or mermaid) for a schema by name
export function getSchemaFormat(schemaName: string): "sql" | "mermaid" {
  if (schemaName === "University") {
    return "mermaid";
  }
  return "sql";
}
