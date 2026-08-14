import type { DatabaseSchema, Table } from "@/shared/types/schema";

// Helper function to calculate center of mass of tables
export function calculateCenterOfMass(
  tables: Table[]
): [number, number, number] {
  if (tables.length === 0) return [0, 0, 0];

  const sum = tables.reduce(
    (acc, item) => {
      const [x, y, z] = item.position;
      return [acc[0] + x, acc[1] + y, acc[2] + z];
    },
    [0, 0, 0]
  );

  return [
    sum[0] / tables.length,
    sum[1] / tables.length,
    sum[2] / tables.length,
  ];
}

// Helper function to center schema by center of mass
export function centerSchemaByMass(schema: DatabaseSchema): DatabaseSchema {
  const centerOfMass = calculateCenterOfMass(schema.tables);

  return {
    ...schema,
    tables: schema.tables.map((table) => ({
      ...table,
      position: [
        table.position[0] - centerOfMass[0],
        table.position[1] - centerOfMass[1],
        table.position[2] - centerOfMass[2],
      ] as [number, number, number],
    })),
  };
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  mass: number;
}

interface LayoutEdge {
  source: string;
  target: string;
}

export function applyForceDirectedLayout(
  schema: DatabaseSchema,
  viewMode: "2D" | "3D" = "3D"
): DatabaseSchema {
  const nodes = new Map<string, LayoutNode>();
  const edges: LayoutEdge[] = [];
  const totalItems = schema.tables.length;

  // Better initial distribution for 3D
  const initialRadius = Math.max(8, Math.sqrt(totalItems) * 2);

  schema.tables.forEach((table, index) => {
    let x, y, z;
    if (viewMode === "3D") {
      // Use golden angle spiral for better initial 3D distribution
      if (totalItems === 1) {
        x = 0;
        y = 0;
        z = 0;
      } else {
        const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // Golden angle in radians
        const theta = goldenAngle * index; // Azimuthal angle
        const yVal = 1 - (index / (totalItems - 1)) * 2; // Distribute from -1 to 1
        const radiusAtY = Math.sqrt(1 - yVal * yVal); // Radius at this y level (for unit sphere)

        x = Math.cos(theta) * radiusAtY * initialRadius;
        y = yVal * initialRadius;
        z = Math.sin(theta) * radiusAtY * initialRadius;
      }
    } else {
      // 2D: distribute evenly around a circle on the xz plane
      const angle = (index / totalItems) * Math.PI * 2;
      x = Math.cos(angle) * initialRadius;
      y = 0;
      z = Math.sin(angle) * initialRadius;
    }

    // Calculate mass based on column count (same for tables and views)
    const mass = 1 + table.columns.length * 0.1;

    nodes.set(table.name, {
      id: table.name,
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      mass,
    });

    // Add edges for all tables and views (views now have relationships via virtual columns)
    table.columns.forEach((column) => {
      if (column.isForeignKey && column.references) {
        edges.push({
          source: table.name,
          target: column.references.table,
        });
      }
    });
  });

  // Adjust parameters for better 3D behavior
  // Scale iterations down for large schemas to avoid blocking the main thread
  const iterations = totalItems > 200 ? 50 : totalItems > 100 ? 80 : 150;
  const springLength = viewMode === "3D" ? 4 : 3; // Longer springs in 3D
  const springStrength = 0.08;
  const repulsionStrength = viewMode === "3D" ? 15 : 12; // Stronger repulsion in 3D
  const damping = 0.85; // Slightly less damping for more movement
  const centerForce = viewMode === "3D" ? 0.01 : 0; // Weak center force in 3D to prevent drift

  // Node degree, used to normalize spring forces. A hub node with hundreds of
  // edges (e.g. a tenant/user table every other table references) would
  // otherwise accumulate a net spring step several times larger than its
  // distance to equilibrium, which makes the integration oscillate with
  // growing amplitude until positions overflow.
  const degree = new Map<string, number>();
  edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  });

  for (let iter = 0; iter < iterations; iter++) {
    // Reset velocities
    nodes.forEach((node) => {
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    });

    // Calculate center of mass for center force
    let centerX = 0,
      centerY = 0,
      centerZ = 0;
    if (viewMode === "3D" && centerForce > 0) {
      nodes.forEach((node) => {
        centerX += node.x;
        centerY += node.y;
        centerZ += node.z;
      });
      centerX /= totalItems;
      centerY /= totalItems;
      centerZ /= totalItems;
    }

    // Repulsion forces between all nodes
    nodes.forEach((node1, id1) => {
      nodes.forEach((node2, id2) => {
        if (id1 === id2) return;

        const dx = node2.x - node1.x;
        const dy = node2.y - node1.y;
        const dz = node2.z - node1.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;

        const repulsion = repulsionStrength / (distance * distance);

        node1.vx -= (dx / distance) * repulsion;
        node1.vy -= (dy / distance) * repulsion;
        node1.vz -= (dz / distance) * repulsion;
      });

      // Weak center force in 3D to prevent collapse to a line
      // This is a weak restoring force that gently pulls nodes toward the center
      if (viewMode === "3D" && centerForce > 0) {
        const dx = centerX - node1.x;
        const dy = centerY - node1.y;
        const dz = centerZ - node1.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;

        // Apply a weak force proportional to distance from center
        // This prevents nodes from collapsing to a line while not being too strong
        node1.vx += (dx / distance) * centerForce * Math.min(distance, 20);
        node1.vy += (dy / distance) * centerForce * Math.min(distance, 20);
        node1.vz += (dz / distance) * centerForce * Math.min(distance, 20);
      }
    });

    // Spring forces along edges
    edges.forEach((edge) => {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);

      if (!source || !target) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dz = target.z - source.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;

      const displacement = (distance - springLength) * springStrength;

      const fx = (dx / distance) * displacement;
      const fy = (dy / distance) * displacement;
      const fz = (dz / distance) * displacement;

      // Normalize by degree so the total spring pull on a node stays bounded
      // regardless of how many edges it has
      const sourceDegree = Math.max(1, degree.get(edge.source) || 1);
      const targetDegree = Math.max(1, degree.get(edge.target) || 1);

      source.vx += fx / (source.mass * sourceDegree);
      source.vy += fy / (source.mass * sourceDegree);
      source.vz += fz / (source.mass * sourceDegree);

      target.vx -= fx / (target.mass * targetDegree);
      target.vy -= fy / (target.mass * targetDegree);
      target.vz -= fz / (target.mass * targetDegree);
    });

    // Update positions with a cooling clamp (Fruchterman-Reingold style):
    // the maximum step shrinks over iterations, which bounds any residual
    // oscillation and lets the layout settle instead of diverging
    const temperature = Math.max(
      0.5,
      initialRadius * 0.3 * (1 - iter / iterations)
    );
    nodes.forEach((node) => {
      let dx = node.vx * damping;
      let dy = node.vy * damping;
      let dz = node.vz * damping;
      const step = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (step > temperature) {
        const scale = temperature / step;
        dx *= scale;
        dy *= scale;
        dz *= scale;
      }
      node.x += dx;
      node.y += dy;
      node.z += dz;
    });
  }

  const updatedTables: Table[] = schema.tables.map((table) => {
    const node = nodes.get(table.name)!;
    // In 2D mode, force y=0; in 3D mode, use calculated y
    const y = viewMode === "2D" ? 0 : node.y;
    return {
      ...table,
      position: [node.x, y, node.z] as [number, number, number],
    };
  });

  // Center the schema by its center of mass
  return centerSchemaByMass({
    ...schema,
    tables: updatedTables,
  });
}

export function applyHierarchicalLayout(
  schema: DatabaseSchema,
  viewMode: "2D" | "3D" = "3D"
): DatabaseSchema {
  const levels = new Map<string, number>();
  const visited = new Set<string>();

  // Build FK adjacency once: the previous per-table scans over all
  // tables x columns made root detection and level assignment O(n^2 x cols),
  // which blocked the main thread for a while on multi-hundred-table schemas
  const outgoing = new Map<string, string[]>(); // table -> tables it references
  const incoming = new Map<string, string[]>(); // table -> tables referencing it
  schema.tables.forEach((table) => {
    table.columns.forEach((col) => {
      if (col.isForeignKey && col.references) {
        let out = outgoing.get(table.name);
        if (!out) outgoing.set(table.name, (out = []));
        out.push(col.references.table);

        let inc = incoming.get(col.references.table);
        if (!inc) incoming.set(col.references.table, (inc = []));
        inc.push(table.name);
      }
    });
  });

  // Include all tables and views in root calculation (views now have relationships)
  const rootTables = schema.tables.filter(
    (table) => !outgoing.has(table.name) || !incoming.has(table.name)
  );

  function assignLevel(tableName: string, level: number) {
    if (visited.has(tableName)) return;
    visited.add(tableName);

    const currentLevel = levels.get(tableName) || 0;
    levels.set(tableName, Math.max(currentLevel, level));

    outgoing.get(tableName)?.forEach((referenced) => {
      assignLevel(referenced, level - 1);
    });
    incoming.get(tableName)?.forEach((referencing) => {
      assignLevel(referencing, level + 1);
    });
  }

  rootTables.forEach((table) => assignLevel(table.name, 0));

  schema.tables.forEach((table) => {
    if (!visited.has(table.name)) {
      assignLevel(table.name, 0);
    }
  });

  const levelGroups = new Map<number, string[]>();
  levels.forEach((level, tableName) => {
    if (!levelGroups.has(level)) {
      levelGroups.set(level, []);
    }
    levelGroups.get(level)!.push(tableName);
  });

  // Position all tables and views together based on their assigned levels
  const updatedTables: Table[] = schema.tables.map((table) => {
    const level = levels.get(table.name) || 0;
    const tablesInLevel = levelGroups.get(level) || [];
    const indexInLevel = tablesInLevel.indexOf(table.name);
    const tablesInLevelCount = tablesInLevel.length;

    if (viewMode === "3D") {
      // In 3D mode, distribute tables within each level using a 2D grid pattern
      // This better utilizes 3D space by spreading tables across Y and Z dimensions

      // Calculate grid dimensions for this level (aim for roughly square grid)
      const gridCols = Math.ceil(Math.sqrt(tablesInLevelCount));
      const gridRows = Math.ceil(tablesInLevelCount / gridCols);

      // Calculate position within the grid
      const row = Math.floor(indexInLevel / gridCols);
      const col = indexInLevel % gridCols;

      // Spacing for the grid
      const gridSpacing = 6; // Spacing between grid cells

      // X position: represents hierarchy depth (levels progress along X)
      const x = level * 12;

      // Y position: vertical position in grid (rows) + level offset for vertical separation
      // Use Y for level separation to avoid diagonal clustering
      const levelYOffset = level * 10; // Offset each level vertically
      const y = levelYOffset + (row - (gridRows - 1) / 2) * gridSpacing;

      // Z position: depth position in grid (columns) - no level offset to avoid diagonal
      const z = (col - (gridCols - 1) / 2) * gridSpacing;

      return {
        ...table,
        position: [x, y, z] as [number, number, number],
      };
    } else {
      // 2D mode: X for level, Z for within-level, Y=0
      const x = level * 12;
      // 2D mode: constrain to y=0, z varies only within level
      const z = (indexInLevel - (tablesInLevelCount - 1) / 2) * 5;
      return {
        ...table,
        position: [x, 0, z] as [number, number, number],
      };
    }
  });

  // Center the schema by its center of mass
  return centerSchemaByMass({
    ...schema,
    tables: updatedTables,
  });
}

export function applyCircularLayout(
  schema: DatabaseSchema,
  viewMode: "2D" | "3D" = "3D"
): DatabaseSchema {
  const totalItems = schema.tables.length;
  // 2D places tables on a single circle, so radius must grow linearly with
  // count to keep spacing. The 3D golden-spiral distributes over a sphere
  // SURFACE (area ~ radius²), so radius only needs to grow with sqrt(count) —
  // linear growth made large schemas impossibly big to frame (400 tables →
  // radius 320 while the camera zoom limit is far smaller).
  const radius =
    viewMode === "3D"
      ? Math.max(6, Math.min(totalItems * 0.8, Math.sqrt(totalItems) * 2.5))
      : Math.max(6, totalItems * 0.8);

  const updatedTables: Table[] = schema.tables.map((table, index) => {
    if (viewMode === "3D") {
      // Use golden angle spiral for uniform spherical distribution
      // This provides better spacing than the previous vertical spiral approach
      if (totalItems === 1) {
        // Single table: place at origin
        return {
          ...table,
          position: [0, 0, 0] as [number, number, number],
        };
      }

      const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // Golden angle in radians
      const theta = goldenAngle * index; // Azimuthal angle
      const y = 1 - (index / (totalItems - 1)) * 2; // Distribute from -1 to 1
      const radiusAtY = Math.sqrt(1 - y * y); // Radius at this y level (for unit sphere)

      const x = Math.cos(theta) * radiusAtY * radius;
      const z = Math.sin(theta) * radiusAtY * radius;
      const yPos = y * radius;

      return {
        ...table,
        position: [x, yPos, z] as [number, number, number],
      };
    } else {
      // 2D: distribute evenly around a circle on the xz plane
      if (totalItems === 1) {
        return {
          ...table,
          position: [0, 0, 0] as [number, number, number],
        };
      }
      const angle = (index / totalItems) * Math.PI * 2;
      return {
        ...table,
        position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius] as [
          number,
          number,
          number,
        ],
      };
    }
  });

  // Center the schema by its center of mass
  return centerSchemaByMass({
    ...schema,
    tables: updatedTables,
  });
}
