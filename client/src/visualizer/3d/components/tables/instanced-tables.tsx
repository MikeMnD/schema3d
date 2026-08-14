import {
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
} from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import type { Table } from "@/shared/types/schema";
import type { AnimatedPositionsRef, Relationship } from "../../types";
import {
  TABLE_HEIGHT,
  TABLE_RADIUS,
  ANIMATION_DURATION,
  LONG_PRESS_DURATION,
  LABEL_Y_OFFSET,
  INSTANCED_MAX_SEGMENTS,
  LABEL_VISIBILITY_DISTANCE,
  LABEL_MAX_COUNT,
} from "../../constants";
import { easeInOutCubic } from "../../utils/camera-utils";
import { shouldDimTable, isTableInRelationship } from "./table-utils";

export interface InstancedTablesProps {
  tables: Table[];
  selectedTable: Table | null;
  hoveredTable: Table | null;
  filteredTables: Set<string>;
  relatedTables: Set<string>;
  connectedTables: Set<string>;
  isFiltering: boolean;
  selectedRelationship: Relationship | null;
  hoveredRelationship: Relationship | null;
  targetPositions: Map<string, [number, number, number]>;
  animationStartTime: number | null;
  isAnimating: boolean;
  animatedPositionsRef?: AnimatedPositionsRef;
  onSelect: (table: Table | null) => void;
  onHover: (table: Table | null) => void;
  onLongPress?: (table: Table) => void;
  onPositionChange?: (
    table: Table,
    newPosition: [number, number, number]
  ) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

interface Bucket {
  key: string;
  segments: number;
  isView: boolean;
  tables: Table[];
}

interface DragState {
  table: Table | null;
  startPointer: THREE.Vector2 | null;
  startPosition: THREE.Vector3 | null;
  dragging: boolean;
}

function tableSegments(table: Table): number {
  const actualColumns = table.columns.filter(
    (col) => !col.name.startsWith("_ref_")
  );
  return Math.min(INSTANCED_MAX_SEGMENTS, Math.max(3, actualColumns.length));
}

const scratchObject = new THREE.Object3D();
const scratchColor = new THREE.Color();
const whiteColor = new THREE.Color("#ffffff");

/**
 * Instanced renderer for large schemas: tables are grouped into one
 * InstancedMesh per (facet count, view flag) bucket, so a 400-table schema
 * costs ~25 draw calls instead of 3+ per table. Selection/search/filter
 * states are per-instance colors; hover and selection additionally get a
 * translucent overlay shell. Labels render only near the camera or for
 * highlighted tables. Interactions (select, hover, long-press, drag of the
 * selected table) match the per-mesh Table3D renderer used for small
 * schemas.
 */
export function InstancedTables({
  tables,
  selectedTable,
  hoveredTable,
  filteredTables,
  relatedTables,
  connectedTables,
  isFiltering,
  selectedRelationship,
  hoveredRelationship,
  targetPositions,
  animationStartTime,
  isAnimating,
  animatedPositionsRef,
  onSelect,
  onHover,
  onLongPress,
  onPositionChange,
  onDragStart,
  onDragEnd,
}: InstancedTablesProps) {
  const { camera, gl } = useThree();

  const buckets = useMemo<Bucket[]>(() => {
    const byKey = new Map<string, Bucket>();
    tables.forEach((table) => {
      const segments = tableSegments(table);
      const isView = table.isView === true;
      const key = `${segments}|${isView ? "v" : "t"}`;
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = { key, segments, isView, tables: [] };
        byKey.set(key, bucket);
      }
      bucket.tables.push(table);
    });
    return Array.from(byKey.values());
  }, [tables]);

  // Snapshot of start positions for the current layout animation
  const startPositionsRef = useRef<Map<string, [number, number, number]>>(
    new Map()
  );
  useEffect(() => {
    if (isAnimating) {
      startPositionsRef.current = new Map(animatedPositionsRef?.current ?? []);
    }
  }, [isAnimating, animationStartTime, animatedPositionsRef]);

  // ---- drag handling (only the selected table is draggable) ----
  const dragStateRef = useRef<DragState>({
    table: null,
    startPointer: null,
    startPosition: null,
    dragging: false,
  });
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);

  const callbacksRef = useRef({ onPositionChange, onDragEnd, onHover });
  useEffect(() => {
    callbacksRef.current = { onPositionChange, onDragEnd, onHover };
  });

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const applyDragMovement = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragStateRef.current;
      if (!drag.table || !drag.startPointer || !drag.startPosition) return;

      const rect = gl.domElement.getBoundingClientRect();
      const pointerX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const pointerY = -((clientY - rect.top) / rect.height) * 2 + 1;
      const deltaX = pointerX - drag.startPointer.x;
      const deltaY = pointerY - drag.startPointer.y;

      const cameraDirection = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      const cameraRight = new THREE.Vector3()
        .crossVectors(cameraDirection, camera.up)
        .normalize();
      const cameraUp = camera.up.clone().normalize();

      const distance = camera.position.distanceTo(drag.startPosition);
      const scale = distance * 0.5;

      const newPosition = drag.startPosition
        .clone()
        .addScaledVector(cameraRight, deltaX * scale)
        .addScaledVector(cameraUp, deltaY * scale);

      callbacksRef.current.onPositionChange?.(drag.table, [
        newPosition.x,
        newPosition.y,
        newPosition.z,
      ]);
    },
    [camera, gl]
  );

  const globalMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const globalUpRef = useRef<(() => void) | null>(null);

  const detachGlobalDragListeners = useCallback(() => {
    if (globalMoveRef.current) {
      window.removeEventListener("pointermove", globalMoveRef.current);
      globalMoveRef.current = null;
    }
    if (globalUpRef.current) {
      window.removeEventListener("pointerup", globalUpRef.current);
      globalUpRef.current = null;
    }
  }, []);

  const endDrag = useCallback(() => {
    const drag = dragStateRef.current;
    if (drag.dragging) {
      drag.dragging = false;
      drag.table = null;
      drag.startPointer = null;
      drag.startPosition = null;
      callbacksRef.current.onDragEnd?.();
      document.body.style.cursor = "default";
    }
    detachGlobalDragListeners();
  }, [detachGlobalDragListeners]);

  const attachGlobalDragListeners = useCallback(() => {
    if (globalMoveRef.current) return;
    const handleMove = (e: PointerEvent) => {
      if (!dragStateRef.current.dragging) return;
      if (e.buttons === 0) {
        endDrag();
        return;
      }
      applyDragMovement(e.clientX, e.clientY);
    };
    const handleUp = () => endDrag();
    globalMoveRef.current = handleMove;
    globalUpRef.current = handleUp;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, [applyDragMovement, endDrag]);

  useEffect(() => {
    return () => {
      detachGlobalDragListeners();
      clearLongPressTimer();
    };
  }, [detachGlobalDragListeners, clearLongPressTimer]);

  const hasSelection = !!(selectedTable || selectedRelationship);

  const makeBucketHandlers = (bucket: Bucket) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const table = e.instanceId != null ? bucket.tables[e.instanceId] : null;
      if (!table) return;
      e.stopPropagation();
      if (!isLongPressRef.current) {
        onSelect(selectedTable?.name === table.name ? null : table);
      }
    },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      const table = e.instanceId != null ? bucket.tables[e.instanceId] : null;
      if (!table) return;
      e.stopPropagation();
      isLongPressRef.current = false;

      // Only the selected table can be dragged (same as Table3D)
      if (selectedTable?.name === table.name && onPositionChange) {
        const rect = gl.domElement.getBoundingClientRect();
        dragStateRef.current.table = table;
        dragStateRef.current.startPointer = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        dragStateRef.current.startPosition = new THREE.Vector3(
          ...table.position
        );
      }

      if (onLongPress) {
        clearLongPressTimer();
        longPressTimerRef.current = setTimeout(() => {
          isLongPressRef.current = true;
          onLongPress(table);
          if (dragStateRef.current.dragging) {
            endDrag();
          }
        }, LONG_PRESS_DURATION);
      }
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const drag = dragStateRef.current;
      if (
        drag.table &&
        drag.startPointer &&
        !isLongPressRef.current &&
        e.buttons > 0
      ) {
        const rect = gl.domElement.getBoundingClientRect();
        const pointerX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const pointerY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const moved =
          Math.abs(pointerX - drag.startPointer.x) > 0.01 ||
          Math.abs(pointerY - drag.startPointer.y) > 0.01;

        if (!drag.dragging && moved) {
          drag.dragging = true;
          clearLongPressTimer();
          attachGlobalDragListeners();
          onDragStart?.();
          document.body.style.cursor = "grabbing";
        }
        if (drag.dragging) {
          e.stopPropagation();
          applyDragMovement(e.clientX, e.clientY);
          return;
        }
      }

      // Hover can move between instances of the same mesh without an
      // over/out pair firing
      const table = e.instanceId != null ? bucket.tables[e.instanceId] : null;
      if (table && table.name !== hoveredTable?.name && !drag.dragging) {
        onHover(table);
      }
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      clearLongPressTimer();
      if (isLongPressRef.current) {
        setTimeout(() => {
          isLongPressRef.current = false;
        }, 200);
      }
      if (dragStateRef.current.dragging) {
        endDrag();
      } else {
        dragStateRef.current.table = null;
        dragStateRef.current.startPointer = null;
        dragStateRef.current.startPosition = null;
      }
    },
    onPointerCancel: () => {
      clearLongPressTimer();
      isLongPressRef.current = false;
      endDrag();
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      const table = e.instanceId != null ? bucket.tables[e.instanceId] : null;
      if (!table || dragStateRef.current.dragging) return;
      e.stopPropagation();
      onHover(table);
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      onHover(null);
      clearLongPressTimer();
      isLongPressRef.current = false;
      if (!dragStateRef.current.dragging) {
        document.body.style.cursor = "default";
      }
    },
  });

  return (
    <group>
      {buckets.map((bucket) => (
        <InstancedBucket
          key={`${bucket.key}:${bucket.tables.length}`}
          bucket={bucket}
          filteredTables={filteredTables}
          relatedTables={relatedTables}
          connectedTables={connectedTables}
          isFiltering={isFiltering}
          hasSelection={hasSelection}
          selectedRelationship={selectedRelationship}
          hoveredRelationship={hoveredRelationship}
          targetPositions={targetPositions}
          animationStartTime={animationStartTime}
          isAnimating={isAnimating}
          animatedPositionsRef={animatedPositionsRef}
          startPositionsRef={startPositionsRef}
          handlers={makeBucketHandlers(bucket)}
        />
      ))}

      {hoveredTable && hoveredTable.name !== selectedTable?.name && (
        <TableOverlay
          table={hoveredTable}
          animatedPositionsRef={animatedPositionsRef}
          opacity={0.3}
          scale={1.18}
        />
      )}
      {selectedTable && (
        <TableOverlay
          table={selectedTable}
          animatedPositionsRef={animatedPositionsRef}
          opacity={0.4}
          scale={1.12}
        />
      )}

      <TableLabels
        tables={tables}
        selectedTable={selectedTable}
        hoveredTable={hoveredTable}
        filteredTables={filteredTables}
        relatedTables={relatedTables}
        animatedPositionsRef={animatedPositionsRef}
      />
    </group>
  );
}

interface InstancedBucketProps {
  bucket: Bucket;
  filteredTables: Set<string>;
  relatedTables: Set<string>;
  connectedTables: Set<string>;
  isFiltering: boolean;
  hasSelection: boolean;
  selectedRelationship: Relationship | null;
  hoveredRelationship: Relationship | null;
  targetPositions: Map<string, [number, number, number]>;
  animationStartTime: number | null;
  isAnimating: boolean;
  animatedPositionsRef?: AnimatedPositionsRef;
  startPositionsRef: React.MutableRefObject<
    Map<string, [number, number, number]>
  >;
  handlers: Record<string, (e: never) => void>;
}

function InstancedBucket({
  bucket,
  filteredTables,
  relatedTables,
  connectedTables,
  isFiltering,
  hasSelection,
  selectedRelationship,
  hoveredRelationship,
  targetPositions,
  animationStartTime,
  isAnimating,
  animatedPositionsRef,
  startPositionsRef,
  handlers,
}: InstancedBucketProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(
    () =>
      new THREE.CylinderGeometry(
        TABLE_RADIUS,
        TABLE_RADIUS,
        TABLE_HEIGHT,
        bucket.segments,
        1,
        bucket.isView
      ),
    [bucket.segments, bucket.isView]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Static instance matrices (animation writes them per frame instead)
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || isAnimating) return;
    bucket.tables.forEach((table, i) => {
      scratchObject.position.set(...table.position);
      scratchObject.updateMatrix();
      mesh.setMatrixAt(i, scratchObject.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [bucket, isAnimating]);

  // Per-instance colors encode dim/highlight/related states
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    bucket.tables.forEach((table, i) => {
      const isDimmed = shouldDimTable(
        table,
        filteredTables,
        relatedTables,
        connectedTables,
        hasSelection,
        isFiltering
      );
      const isHighlighted = filteredTables.has(table.name);
      const isRelated = relatedTables.has(table.name);
      const isRelationshipHighlighted =
        isTableInRelationship(table, selectedRelationship) ||
        isTableInRelationship(table, hoveredRelationship);

      scratchColor.set(table.color);
      if (isDimmed) {
        scratchColor.multiplyScalar(0.35);
      } else if (isHighlighted) {
        scratchColor.lerp(whiteColor, 0.35);
      } else if (isRelated || isRelationshipHighlighted) {
        scratchColor.lerp(whiteColor, 0.2);
      }
      mesh.setColorAt(i, scratchColor);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [
    bucket,
    filteredTables,
    relatedTables,
    connectedTables,
    isFiltering,
    hasSelection,
    selectedRelationship,
    hoveredRelationship,
  ]);

  // Layout animation: interpolate all instances of this bucket in one loop
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !isAnimating || animationStartTime == null) return;

    const elapsed = (Date.now() - animationStartTime) / 1000;
    const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
    const eased = easeInOutCubic(progress);

    bucket.tables.forEach((table, i) => {
      const start = startPositionsRef.current.get(table.name) || table.position;
      const target = targetPositions.get(table.name) || table.position;
      const position: [number, number, number] =
        progress >= 1
          ? [target[0], target[1], target[2]]
          : [
              THREE.MathUtils.lerp(start[0], target[0], eased),
              THREE.MathUtils.lerp(start[1], target[1], eased),
              THREE.MathUtils.lerp(start[2], target[2], eased),
            ];
      scratchObject.position.set(...position);
      scratchObject.updateMatrix();
      mesh.setMatrixAt(i, scratchObject.matrix);
      animatedPositionsRef?.current.set(table.name, position);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, bucket.tables.length]}
      geometry={geometry}
      {...handlers}
    >
      <meshStandardMaterial
        flatShading
        metalness={bucket.isView ? 0 : 0.3}
        roughness={0.7}
        side={bucket.isView ? THREE.DoubleSide : THREE.FrontSide}
      />
    </instancedMesh>
  );
}

interface TableOverlayProps {
  table: Table;
  animatedPositionsRef?: AnimatedPositionsRef;
  opacity: number;
  scale: number;
}

/** Translucent glow shell marking the hovered/selected table. */
function TableOverlay({
  table,
  animatedPositionsRef,
  opacity,
  scale,
}: TableOverlayProps) {
  const groupRef = useRef<THREE.Group>(null);
  const segments = tableSegments(table);

  const geometry = useMemo(
    () =>
      new THREE.CylinderGeometry(
        TABLE_RADIUS * scale,
        TABLE_RADIUS * scale,
        TABLE_HEIGHT * scale,
        segments,
        1,
        false
      ),
    [segments, scale]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    if (!groupRef.current) return;
    const position =
      animatedPositionsRef?.current.get(table.name) || table.position;
    groupRef.current.position.set(position[0], position[1], position[2]);
  });

  return (
    <group ref={groupRef} position={table.position}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={table.color}
          emissive={table.color}
          emissiveIntensity={0.6}
          transparent
          opacity={opacity}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

interface TableLabelsProps {
  tables: Table[];
  selectedTable: Table | null;
  hoveredTable: Table | null;
  filteredTables: Set<string>;
  relatedTables: Set<string>;
  animatedPositionsRef?: AnimatedPositionsRef;
}

/**
 * Distance-culled labels: only tables near the camera (or highlighted by
 * selection/hover/search) get a Text object. Rendering all 400 labels cost
 * a draw call each and a per-frame billboard update; zoomed out they are
 * unreadable anyway.
 */
function TableLabels({
  tables,
  selectedTable,
  hoveredTable,
  filteredTables,
  relatedTables,
  animatedPositionsRef,
}: TableLabelsProps) {
  const { camera } = useThree();
  const [labelNames, setLabelNames] = useState<string[]>([]);
  const labelNamesRef = useRef<string[]>([]);
  const frameCounterRef = useRef(0);
  const labelGroupsRef = useRef(new Map<string, THREE.Group>());

  const tableByName = useMemo(
    () => new Map(tables.map((table) => [table.name, table])),
    [tables]
  );

  useFrame(() => {
    // Billboard + position sync every frame for the mounted labels
    const animatedPositions = animatedPositionsRef?.current;
    labelGroupsRef.current.forEach((group, name) => {
      const table = tableByName.get(name);
      if (!table) return;
      const position = animatedPositions?.get(name) || table.position;
      group.position.set(
        position[0],
        position[1] + LABEL_Y_OFFSET,
        position[2]
      );
      group.lookAt(camera.position);
    });

    // Recompute WHICH labels are visible at ~4Hz
    if (++frameCounterRef.current % 15 !== 0) return;

    const next: string[] = [];
    const seen = new Set<string>();
    const add = (name: string) => {
      if (!seen.has(name) && tableByName.has(name)) {
        seen.add(name);
        next.push(name);
      }
    };

    if (selectedTable) add(selectedTable.name);
    if (hoveredTable) add(hoveredTable.name);
    filteredTables.forEach(add);
    relatedTables.forEach(add);

    const maxDistanceSq = LABEL_VISIBILITY_DISTANCE * LABEL_VISIBILITY_DISTANCE;
    for (const table of tables) {
      if (next.length >= LABEL_MAX_COUNT) break;
      if (seen.has(table.name)) continue;
      const position = animatedPositions?.get(table.name) || table.position;
      const dx = camera.position.x - position[0];
      const dy = camera.position.y - position[1];
      const dz = camera.position.z - position[2];
      if (dx * dx + dy * dy + dz * dz < maxDistanceSq) {
        add(table.name);
      }
    }

    const previous = labelNamesRef.current;
    const unchanged =
      previous.length === next.length &&
      previous.every((name, i) => name === next[i]);
    if (!unchanged) {
      labelNamesRef.current = next;
      setLabelNames(next);
    }
  });

  return (
    <group>
      {labelNames.map((name) => {
        const table = tableByName.get(name);
        if (!table) return null;
        return (
          <group
            key={name}
            ref={(group) => {
              if (group) labelGroupsRef.current.set(name, group);
              else labelGroupsRef.current.delete(name);
            }}
            position={[
              table.position[0],
              table.position[1] + LABEL_Y_OFFSET,
              table.position[2],
            ]}
          >
            <Text
              fontSize={0.3}
              color="white"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.02}
              outlineColor="#000000"
            >
              {name}
            </Text>
          </group>
        );
      })}
    </group>
  );
}
