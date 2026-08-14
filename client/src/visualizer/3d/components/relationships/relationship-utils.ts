import * as THREE from "three";
import type {
  Cardinality,
  CardinalitySymbol,
  LineStyle,
  Relationship,
} from "../../types";
import type { DatabaseSchema } from "@/shared/types/schema";
import { TABLE_RADIUS, RELATIONSHIP_LINE_Y_OFFSET } from "../../constants";

/**
 * Calculate relationship cardinality based on UNIQUE constraints and NULL/NOT NULL constraints
 *
 * Rules:
 * - The table with the FK is always the many side (right side of cardinality)
 * - The table being pointed to is always the 1 side (left side of cardinality)
 * - If the FK column is nullable, the parent (referenced table) is 0 or 1 (0..1)
 * - If the FK column is NOT NULL, the parent (referenced table) is 1 and only 1 (1)
 *
 * Cardinality format: "left:right" where:
 * - left = referenced table side (the "1" side)
 * - right = FK table side (the "many" side, unless FK is unique then it's "1")
 *
 * Many side (right side) determination (conservative approach):
 * - If FK is unique → "1" (one-to-one relationship)
 * - If FK is NOT NULL and not unique → "1..N" (parent must have at least 1 child)
 * - If FK is explicitly NULL and not unique → "0..N" (parent can have 0 children)
 * - If FK nullable status is unknown and not unique → "N" (generic many, ambiguous)
 *
 * Examples:
 * - FK nullable, not unique → "0..1:0..N" (many children can reference 0 or 1 parent, parent can have 0 children)
 * - FK NOT NULL, not unique → "1:1..N" (many children must reference exactly 1 parent, parent must have at least 1 child)
 * - FK nullable, unique → "0..1:1" (one child can reference 0 or 1 parent)
 * - FK NOT NULL, unique → "1:1" (one child must reference exactly 1 parent)
 * - FK unknown nullable, not unique → "0..1:N" (generic many, ambiguous participation)
 *
 * Note: This cardinality format is used consistently throughout the codebase. When displaying
 * relationships, the symbols are mapped as follows:
 * - fromTable (FK table) displays the "right" symbol
 * - toTable (referenced table) displays the "left" symbol
 */
export function calculateCardinality(
  pkColumn: { isPrimaryKey?: boolean; isUnique?: boolean } | undefined,
  fkColumn: { isUnique?: boolean; isNullable?: boolean }
): Cardinality {
  const fkIsUnique = fkColumn.isUnique || false;

  // Determine the left side (referenced table / parent side)
  // If FK is nullable → parent is 0 or 1 (0..1)
  // If FK is NOT NULL → parent is 1 and only 1 (1)
  // Conservative: if nullable status is unknown, default to nullable (0..1)
  const fkIsNullable = fkColumn.isNullable !== false;
  const leftSide: CardinalitySymbol = fkIsNullable ? "0..1" : "1";

  // Determine the right side (FK table / child side)
  // Conservative approach: only use specific cardinality when we have explicit information
  let rightSide: CardinalitySymbol;
  if (fkIsUnique) {
    // One-to-one relationship
    rightSide = "1";
  } else {
    // Many relationship - distinguish based on nullable status (conservative)
    if (fkColumn.isNullable === false) {
      // NOT NULL = parent must have at least 1 child
      rightSide = "1..N";
    } else if (fkColumn.isNullable === true) {
      // Explicitly NULL = parent can have 0 children
      rightSide = "0..N";
    } else {
      // Unknown nullable status = generic many (ambiguous)
      rightSide = "N";
    }
  }

  // Combine into cardinality string
  return `${leftSide}:${rightSide}` as Cardinality;
}

/**
 * Parse a Cardinality string ("1:N", "0..1:1..N", "0..N:0..N", etc.)
 * into left/right symbols plus convenience flags for "many" sides.
 */
export function parseCardinality(cardinality: Cardinality): {
  left: CardinalitySymbol;
  right: CardinalitySymbol;
  leftIsMany: boolean;
  rightIsMany: boolean;
} {
  const [leftRaw, rightRaw] = cardinality.split(":") as [
    CardinalitySymbol,
    CardinalitySymbol,
  ];

  const isMany = (symbol: CardinalitySymbol): boolean =>
    symbol === "N" || symbol === "0..N" || symbol === "1..N";

  return {
    left: leftRaw,
    right: rightRaw,
    leftIsMany: isMany(leftRaw),
    rightIsMany: isMany(rightRaw),
  };
}

/**
 * Build the list of FK relationships between visible tables.
 *
 * Uses a lowercase name -> table map so the cost is O(tables + FK columns);
 * the previous per-FK schema.tables.find(...toLowerCase()) scan was
 * O(FK columns x tables), which was noticeable on every filter change with
 * hundreds of tables.
 */
export function buildRelationships(
  schema: DatabaseSchema,
  visibleTableNames?: Set<string>
): Relationship[] {
  const result: Relationship[] = [];
  const tableByLowerName = new Map(
    schema.tables.map((table) => [table.name.toLowerCase(), table])
  );

  schema.tables.forEach((table) => {
    // Skip if table is not visible
    if (visibleTableNames && !visibleTableNames.has(table.name)) {
      return;
    }

    table.columns.forEach((column) => {
      if (column.isForeignKey && column.references) {
        // Case-insensitive matching to handle table name variations
        const referencedTable = tableByLowerName.get(
          column.references.table.toLowerCase()
        );

        // Only include relationship if both tables are visible
        if (
          referencedTable &&
          (!visibleTableNames || visibleTableNames.has(referencedTable.name))
        ) {
          // Always use table.position for the initial relationship structure;
          // per-frame updates handle animated positions separately
          const fromCenter = new THREE.Vector3(...table.position);
          const toCenter = new THREE.Vector3(...referencedTable.position);

          fromCenter.y += RELATIONSHIP_LINE_Y_OFFSET;
          toCenter.y += RELATIONSHIP_LINE_Y_OFFSET;

          const direction = new THREE.Vector3()
            .subVectors(toCenter, fromCenter)
            .normalize();

          // Move start/end points to table surface
          const fromPos = getTableSurfacePoint(
            fromCenter,
            direction,
            TABLE_RADIUS
          );
          const toPos = getTableSurfacePoint(
            toCenter,
            direction.clone().multiplyScalar(-1),
            TABLE_RADIUS
          );

          const curve = new THREE.LineCurve3(fromPos, toPos);
          const points = [fromPos.clone(), toPos.clone()];
          const midpoint = new THREE.Vector3()
            .addVectors(fromPos, toPos)
            .multiplyScalar(0.5);

          // Find the PK column in the referenced table
          const pkColumn = referencedTable.columns.find(
            (c) => c.name === column.references!.column
          );

          // Use stored cardinality from Mermaid if available, otherwise
          // calculate from UNIQUE constraints
          const cardinality: Cardinality =
            (column.references.cardinality as Cardinality | undefined) ||
            calculateCardinality(pkColumn, column);

          result.push({
            id: `${table.name}.${column.name}->${referencedTable.name}.${column.references.column}`,
            points,
            fromTable: table.name,
            toTable: referencedTable.name,
            fkColumn: column.name,
            pkColumn: column.references.column,
            midpoint,
            curve,
            cardinality,
          });
        }
      }
    });
  });

  return result;
}

/**
 * Calculate line styling based on selection and hover state
 */
export function getLineStyle(
  isSelected: boolean,
  isHovered: boolean,
  isConnectedToSelectedTable: boolean
): LineStyle {
  return {
    color: isSelected
      ? "#60a5fa"
      : isHovered
        ? "#93c5fd"
        : isConnectedToSelectedTable
          ? "#64748b"
          : "#334155",
    opacity: isSelected
      ? 1
      : isHovered
        ? 0.9
        : isConnectedToSelectedTable
          ? 0.9
          : 0.8,
    width: isSelected
      ? 3.5
      : isHovered
        ? 3
        : isConnectedToSelectedTable
          ? 3
          : 2.5,
  };
}

/**
 * Get a perpendicular vector to a given tangent vector
 */
export function getPerpendicular(tangent: THREE.Vector3): THREE.Vector3 {
  // Try different up vectors to find a good perpendicular
  const upVectors = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
  ];

  for (const up of upVectors) {
    const perp = new THREE.Vector3().crossVectors(tangent, up);
    if (perp.length() > 0.1) {
      return perp.normalize();
    }
  }

  // Fallback: create a perpendicular using a different method
  const perp = new THREE.Vector3();
  if (Math.abs(tangent.y) < 0.9) {
    perp.set(0, 1, 0).cross(tangent).normalize();
  } else {
    perp.set(1, 0, 0).cross(tangent).normalize();
  }
  return perp;
}

/**
 * Calculate surface point on a table cylinder given center and direction
 * If out parameter is provided, writes to it instead of creating a new Vector3
 */
export function getTableSurfacePoint(
  center: THREE.Vector3,
  direction: THREE.Vector3,
  radius: number,
  out?: THREE.Vector3
): THREE.Vector3 {
  if (out) {
    return out.copy(center).add(direction.clone().multiplyScalar(radius));
  }
  return center.clone().add(direction.clone().multiplyScalar(radius));
}
