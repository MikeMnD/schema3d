import { useMemo, useRef, useEffect, useCallback } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { Suspense } from "react";
import { LABEL_FONT } from "../../label-font";
import {
  LineSegments2,
  LineSegmentsGeometry,
  LineMaterial,
} from "three-stdlib";
import type { Relationship, RelationshipLinesProps } from "../../types";
import {
  LONG_PRESS_DURATION,
  TABLE_RADIUS,
  RELATIONSHIP_LINE_Y_OFFSET,
} from "../../constants";
import {
  buildRelationships,
  getLineStyle,
  getTableSurfacePoint,
} from "./relationship-utils";
import { CardinalityNotation } from "./cardinality";

/**
 * Renders ALL relationship lines of a large schema as a single fat-line
 * batch (one draw call) instead of one Line2 + one invisible collider tube
 * per relationship. Picking uses LineSegments2's raycast, which reports the
 * segment index as faceIndex.
 *
 * Selection/hover feedback is expressed through per-segment colors; the
 * selected relationship additionally gets the ERD cardinality notation and
 * a label, so no functionality is lost against the per-line renderer used
 * for small schemas.
 */
export function BatchedRelationshipLines({
  schema,
  selectedRelationship,
  hoveredRelationship,
  selectedTable,
  onSelect,
  onHover,
  onLongPress,
  animatedPositionsRef,
  visibleTableNames,
}: RelationshipLinesProps) {
  const { size, camera } = useThree();

  const relationships = useMemo<Relationship[]>(
    () => buildRelationships(schema, visibleTableNames),
    [schema, visibleTableNames]
  );

  const tableLookup = useMemo(() => {
    const lookup = new Map<string, (typeof schema.tables)[0]>();
    schema.tables.forEach((table) => lookup.set(table.name, table));
    return lookup;
  }, [schema]);

  // One geometry/material/mesh for the whole relationship set
  const line = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    const positions = new Float32Array(Math.max(1, relationships.length) * 6);
    relationships.forEach((rel, i) => {
      positions[i * 6] = rel.points[0].x;
      positions[i * 6 + 1] = rel.points[0].y;
      positions[i * 6 + 2] = rel.points[0].z;
      positions[i * 6 + 3] = rel.points[1].x;
      positions[i * 6 + 4] = rel.points[1].y;
      positions[i * 6 + 5] = rel.points[1].z;
    });
    geometry.setPositions(positions);
    geometry.setColors(new Float32Array(Math.max(1, relationships.length) * 6));

    const material = new LineMaterial({
      linewidth: 2.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
    });
    const segments = new LineSegments2(geometry, material);
    segments.computeLineDistances();
    return segments;
  }, [relationships]);

  // Dispose GPU resources when the batch is rebuilt or unmounted
  useEffect(() => {
    return () => {
      line.geometry.dispose();
      line.material.dispose();
    };
  }, [line]);

  // Fat-line materials need the viewport resolution for width calculations
  useEffect(() => {
    line.material.resolution.set(size.width, size.height);
  }, [line, size.width, size.height]);

  // Per-segment colors from selection/hover state
  useEffect(() => {
    const colorAttrStart = line.geometry.getAttribute("instanceColorStart");
    const colorAttrEnd = line.geometry.getAttribute("instanceColorEnd");
    if (!colorAttrStart || !colorAttrEnd) return;
    const color = new THREE.Color();
    relationships.forEach((rel, i) => {
      const style = getLineStyle(
        selectedRelationship?.id === rel.id,
        hoveredRelationship?.id === rel.id,
        selectedTable
          ? rel.fromTable === selectedTable.name ||
              rel.toTable === selectedTable.name
          : false
      );
      color.set(style.color);
      colorAttrStart.setXYZ(i, color.r, color.g, color.b);
      colorAttrEnd.setXYZ(i, color.r, color.g, color.b);
    });
    colorAttrStart.needsUpdate = true;
    colorAttrEnd.needsUpdate = true;
  }, [
    line,
    relationships,
    selectedRelationship,
    hoveredRelationship,
    selectedTable,
  ]);

  // Scratch vectors reused across frames to avoid per-frame allocations
  const scratch = useRef({
    fromCenter: new THREE.Vector3(),
    toCenter: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    reverseDirection: new THREE.Vector3(),
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
  }).current;

  // Sync segment endpoints with table positions (animated or static).
  // One loop for the whole batch; buffers only re-upload when something moved.
  useFrame(() => {
    const positionStart = line.geometry.getAttribute(
      "instanceStart"
    ) as THREE.BufferAttribute;
    const positionEnd = line.geometry.getAttribute(
      "instanceEnd"
    ) as THREE.BufferAttribute;
    if (!positionStart || !positionEnd) return;

    const animatedPositions = animatedPositionsRef?.current;
    let changed = false;

    for (let i = 0; i < relationships.length; i++) {
      const rel = relationships[i];
      const fromTable = tableLookup.get(rel.fromTable);
      const toTable = tableLookup.get(rel.toTable);
      if (!fromTable || !toTable) continue;

      const fromPosition =
        animatedPositions?.get(rel.fromTable) || fromTable.position;
      const toPosition =
        animatedPositions?.get(rel.toTable) || toTable.position;

      scratch.fromCenter.set(
        fromPosition[0],
        fromPosition[1] + RELATIONSHIP_LINE_Y_OFFSET,
        fromPosition[2]
      );
      scratch.toCenter.set(
        toPosition[0],
        toPosition[1] + RELATIONSHIP_LINE_Y_OFFSET,
        toPosition[2]
      );
      scratch.direction
        .subVectors(scratch.toCenter, scratch.fromCenter)
        .normalize();
      scratch.reverseDirection.copy(scratch.direction).multiplyScalar(-1);

      getTableSurfacePoint(
        scratch.fromCenter,
        scratch.direction,
        TABLE_RADIUS,
        scratch.fromPos
      );
      getTableSurfacePoint(
        scratch.toCenter,
        scratch.reverseDirection,
        TABLE_RADIUS,
        scratch.toPos
      );

      if (
        Math.abs(positionStart.getX(i) - scratch.fromPos.x) > 0.001 ||
        Math.abs(positionStart.getY(i) - scratch.fromPos.y) > 0.001 ||
        Math.abs(positionStart.getZ(i) - scratch.fromPos.z) > 0.001 ||
        Math.abs(positionEnd.getX(i) - scratch.toPos.x) > 0.001 ||
        Math.abs(positionEnd.getY(i) - scratch.toPos.y) > 0.001 ||
        Math.abs(positionEnd.getZ(i) - scratch.toPos.z) > 0.001
      ) {
        positionStart.setXYZ(
          i,
          scratch.fromPos.x,
          scratch.fromPos.y,
          scratch.fromPos.z
        );
        positionEnd.setXYZ(
          i,
          scratch.toPos.x,
          scratch.toPos.y,
          scratch.toPos.z
        );
        changed = true;
      }
    }

    if (changed) {
      positionStart.needsUpdate = true;
      positionEnd.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  });

  // ---- picking ----
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const relationshipFromEvent = useCallback(
    (e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>) =>
      e.faceIndex != null ? relationships[e.faceIndex] : undefined,
    [relationships]
  );

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Label for the hovered/selected relationship (billboarded per frame)
  const labelRelationship = hoveredRelationship ?? selectedRelationship;
  const labelGroupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!labelGroupRef.current || !labelRelationship) return;
    const fromTable = tableLookup.get(labelRelationship.fromTable);
    const toTable = tableLookup.get(labelRelationship.toTable);
    if (!fromTable || !toTable) return;
    const animatedPositions = animatedPositionsRef?.current;
    const fromPosition =
      animatedPositions?.get(labelRelationship.fromTable) || fromTable.position;
    const toPosition =
      animatedPositions?.get(labelRelationship.toTable) || toTable.position;
    labelGroupRef.current.position.set(
      (fromPosition[0] + toPosition[0]) / 2,
      (fromPosition[1] + toPosition[1]) / 2 + 0.3,
      (fromPosition[2] + toPosition[2]) / 2
    );
    labelGroupRef.current.lookAt(camera.position);
  });

  return (
    <group>
      <primitive
        object={line}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          const rel = relationshipFromEvent(e);
          if (!rel) return;
          e.stopPropagation();
          if (!isLongPressRef.current && onSelect) {
            onSelect(selectedRelationship?.id === rel.id ? null : rel);
          }
          isLongPressRef.current = false;
        }}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          const rel = relationshipFromEvent(e);
          if (!rel) return;
          e.stopPropagation();
          isLongPressRef.current = false;
          if (onLongPress) {
            clearLongPressTimer();
            longPressTimerRef.current = setTimeout(() => {
              isLongPressRef.current = true;
              onLongPress(rel);
            }, LONG_PRESS_DURATION);
          }
        }}
        onPointerUp={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          clearLongPressTimer();
          if (isLongPressRef.current) {
            setTimeout(() => {
              isLongPressRef.current = false;
            }, 200);
          }
        }}
        onPointerCancel={() => {
          clearLongPressTimer();
          isLongPressRef.current = false;
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          const rel = relationshipFromEvent(e);
          if (!rel) return;
          e.stopPropagation();
          onHover?.(rel);
          document.body.style.cursor = "pointer";
        }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          // Hover can move between segments of the same batched object
          // without an over/out pair firing
          const rel = relationshipFromEvent(e);
          if (rel && rel.id !== hoveredRelationship?.id) {
            onHover?.(rel);
          }
        }}
        onPointerOut={() => {
          clearLongPressTimer();
          isLongPressRef.current = false;
          onHover?.(null);
          document.body.style.cursor = "default";
        }}
      />

      {labelRelationship && (
        <group ref={labelGroupRef}>
          <Suspense fallback={null}>
            <Text
              font={LABEL_FONT}
              position={[0, 0, 0]}
              fontSize={0.25}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.02}
              outlineColor="#000000"
            >
              {labelRelationship.fkColumn} → {labelRelationship.pkColumn}
            </Text>
          </Suspense>
        </group>
      )}

      {selectedRelationship && (
        <CardinalityNotation
          relationship={selectedRelationship}
          lineColor={getLineStyle(true, false, false).color}
        />
      )}
    </group>
  );
}
