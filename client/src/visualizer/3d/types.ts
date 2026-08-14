import * as THREE from "three";
import type { MutableRefObject } from "react";
import type { Table, DatabaseSchema } from "@/shared/types/schema";

/**
 * Shared mutable map of table name -> position, written by Table3D during
 * layout animations and read by relationship lines inside useFrame. Kept in
 * a ref (not React state) so per-frame position updates never re-render.
 */
export type AnimatedPositionsRef = MutableRefObject<
  Map<string, [number, number, number]>
>;

export type CardinalitySymbol = "1" | "N" | "0..1" | "1..N" | "0..N";
export type Cardinality = `${CardinalitySymbol}:${CardinalitySymbol}`;

export interface Relationship {
  id: string;
  points: THREE.Vector3[];
  fromTable: string;
  toTable: string;
  fkColumn: string;
  pkColumn: string;
  midpoint: THREE.Vector3;
  // use a generic Curve so we can use LineCurve3 for straight lines
  curve: THREE.Curve<THREE.Vector3>;
  cardinality: Cardinality; // Relationship cardinality
}

export interface Table3DProps {
  table: Table;
  isSelected: boolean;
  isHovered: boolean;
  isHighlighted?: boolean;
  isRelated?: boolean;
  isDimmed?: boolean;
  isRelationshipHighlighted?: boolean;
  simplifiedRendering?: boolean;
  onSelect: (table: Table | null) => void;
  onHover: (table: Table | null) => void;
  onLongPress?: (table: Table) => void;
  onPositionChange?: (
    table: Table,
    newPosition: [number, number, number]
  ) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  targetPosition?: [number, number, number];
  animationStartTime?: number | null;
  isAnimating?: boolean;
  animatedPositionsRef?: AnimatedPositionsRef;
}

export interface RelationshipLinesProps {
  schema: DatabaseSchema;
  selectedRelationship?: Relationship | null;
  hoveredRelationship?: Relationship | null;
  selectedTable?: Table | null;
  onSelect?: (relationship: Relationship | null) => void;
  onHover?: (relationship: Relationship | null) => void;
  onLongPress?: (relationship: Relationship) => void;
  animatedPositionsRef?: AnimatedPositionsRef;
  visibleTableNames?: Set<string>;
}

export interface RelationshipLineProps {
  relationship: Relationship;
  isSelected: boolean;
  isHovered: boolean;
  lineColor: string;
  lineOpacity: number;
  lineWidth: number;
  onSelect?: (relationship: Relationship | null) => void;
  onHover?: (relationship: Relationship | null) => void;
  onLongPress?: (relationship: Relationship) => void;
  animatedPositionsRef?: AnimatedPositionsRef;
  schema: DatabaseSchema;
  showLabel?: boolean;
}

export interface CardinalityNotationProps {
  relationship: Relationship;
  lineColor: string;
}

export interface LineStyle {
  color: string;
  opacity: number;
  width: number;
}
