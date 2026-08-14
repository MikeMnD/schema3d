import { describe, it, expect } from "vitest";
import {
  applyForceDirectedLayout,
  applyCircularLayout,
} from "@/visualizer/3d/utils/layout-algorithm";
import type { DatabaseSchema, Table } from "@/shared/types/schema";

/**
 * Build a hub-heavy schema shaped like real enterprise databases (e.g. ABP
 * framework): a few hub tables (users/tenants) referenced by hundreds of
 * FK columns. This topology made the force layout diverge: unnormalized
 * spring forces on hubs summed to steps far larger than the distance to
 * equilibrium, and positions overflowed to ~1e32.
 */
function buildHubSchema(tableCount: number): DatabaseSchema {
  const tables: Table[] = [];
  for (let i = 0; i < tableCount; i++) {
    const columns = [
      { name: "Id", type: "BIGINT", isPrimaryKey: true, isForeignKey: false },
    ] as Table["columns"];
    if (i > 0) {
      columns.push({
        name: "TenantId",
        type: "INTEGER",
        isPrimaryKey: false,
        isForeignKey: true,
        references: { table: "Table0", column: "Id" },
      });
      columns.push({
        name: "UserId",
        type: "BIGINT",
        isPrimaryKey: false,
        isForeignKey: true,
        references: { table: "Table1", column: "Id" },
      });
    }
    tables.push({
      name: `Table${i}`,
      columns,
      position: [0, 0, 0],
      color: "#ff0000",
      category: "General",
    });
  }
  return { name: "hub-schema", format: "sql", tables };
}

function maxDistanceFromOrigin(schema: DatabaseSchema): number {
  return Math.max(
    ...schema.tables.map((t) =>
      Math.sqrt(t.position[0] ** 2 + t.position[1] ** 2 + t.position[2] ** 2)
    )
  );
}

describe("applyForceDirectedLayout stability", () => {
  it("keeps positions finite and bounded for hub-heavy schemas (3D)", () => {
    const schema = buildHubSchema(300);
    const result = applyForceDirectedLayout(schema, "3D");

    for (const table of result.tables) {
      for (const coord of table.position) {
        expect(Number.isFinite(coord)).toBe(true);
      }
    }
    // Positions must stay in the same order of magnitude as the initial
    // radius (sqrt(300) * 2 ≈ 35), not explode to 1e30+
    expect(maxDistanceFromOrigin(result)).toBeLessThan(300);
  });

  it("keeps positions finite and bounded for hub-heavy schemas (2D)", () => {
    const schema = buildHubSchema(300);
    const result = applyForceDirectedLayout(schema, "2D");

    for (const table of result.tables) {
      for (const coord of table.position) {
        expect(Number.isFinite(coord)).toBe(true);
      }
    }
    expect(maxDistanceFromOrigin(result)).toBeLessThan(300);
  });

  it("still spreads tables apart instead of collapsing them", () => {
    const schema = buildHubSchema(100);
    const result = applyForceDirectedLayout(schema, "3D");

    // At least some pair of tables should be well separated
    expect(maxDistanceFromOrigin(result)).toBeGreaterThan(3);

    // No two tables should end up at the same point
    const seen = new Set(
      result.tables.map((t) => t.position.map((v) => v.toFixed(2)).join(","))
    );
    expect(seen.size).toBe(result.tables.length);
  });
});

describe("applyCircularLayout scaling", () => {
  it("keeps large 3D spheres frameable (sqrt growth, not linear)", () => {
    const schema = buildHubSchema(400);
    const result = applyCircularLayout(schema, "3D");
    // Old linear radius: 400 * 0.8 = 320 — larger than the camera could
    // zoom out. sqrt scaling: sqrt(400) * 2.5 = 50.
    expect(maxDistanceFromOrigin(result)).toBeLessThan(120);
  });

  it("keeps the linear radius for the 2D single circle", () => {
    const schema = buildHubSchema(100);
    const result = applyCircularLayout(schema, "2D");
    // 2D needs linear growth to keep spacing on the circle circumference
    expect(maxDistanceFromOrigin(result)).toBeGreaterThan(50);
  });
});
