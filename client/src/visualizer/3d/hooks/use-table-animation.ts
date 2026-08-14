import { useState, useRef, useCallback } from "react";
import type { DatabaseSchema } from "@/shared/types/schema";
import type { AnimatedPositionsRef } from "../types";

interface UseTableAnimationReturn {
  targetPositions: Map<string, [number, number, number]>;
  animationStartTime: number | null;
  isAnimating: boolean;
  animatedPositionsRef: AnimatedPositionsRef;
  startTableAnimation: (schemaLayout: DatabaseSchema) => void;
}

/**
 * Manages table position animations when switching layouts or view modes.
 *
 * React state changes only at animation start/end. The per-frame animated
 * positions live exclusively in `animatedPositionsRef`: each Table3D writes
 * its interpolated position there from useFrame, and relationship lines read
 * it from their own useFrame. Routing the per-frame positions through React
 * state (a fresh Map per table per frame) previously re-rendered the whole
 * scene graph ~400 times per frame and dropped layout animations to 9fps on
 * large schemas.
 */
export function useTableAnimation(
  setCurrentSchema: React.Dispatch<React.SetStateAction<DatabaseSchema>>
): UseTableAnimationReturn {
  const [animationStartTimeState, setAnimationStartTimeState] = useState<
    number | null
  >(null);
  const [isAnimatingState, setIsAnimatingState] = useState(false);

  const [targetPositions, setTargetPositions] = useState<
    Map<string, [number, number, number]>
  >(new Map());
  const animationStartTimeRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);
  const animatedPositionsRef = useRef<Map<string, [number, number, number]>>(
    new Map()
  );
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startTableAnimation = useCallback(
    (schemaLayout: DatabaseSchema) => {
      // Validate schemaLayout
      if (
        !schemaLayout ||
        !schemaLayout.tables ||
        !Array.isArray(schemaLayout.tables)
      ) {
        console.error(
          "Invalid schemaLayout passed to startTableAnimation:",
          schemaLayout
        );
        return;
      }

      // Cancel any pending animation
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }

      // Get current schema positions as starting points
      setCurrentSchema((prevSchema) => {
        // Validate prevSchema
        if (
          !prevSchema ||
          !prevSchema.tables ||
          !Array.isArray(prevSchema.tables)
        ) {
          console.error(
            "Invalid prevSchema in startTableAnimation:",
            prevSchema
          );
          return prevSchema;
        }

        // Initialize animatedPositions with CURRENT positions
        // If there's an ongoing animation, use the current animated positions
        // Otherwise, use table.position from the schema
        const initialPositions = new Map<string, [number, number, number]>();
        prevSchema.tables.forEach((table) => {
          // Use current animated position if available, otherwise use table.position
          const currentPosition =
            animatedPositionsRef.current.get(table.name) || table.position;
          initialPositions.set(table.name, currentPosition);
        });

        animatedPositionsRef.current = initialPositions;

        // Set target positions from the new layout
        const newTargetPositions = new Map<string, [number, number, number]>();
        schemaLayout.tables.forEach((table) => {
          newTargetPositions.set(table.name, table.position);
        });
        setTargetPositions(newTargetPositions);
        const startTime = Date.now();
        animationStartTimeRef.current = startTime;
        isAnimatingRef.current = true;
        setAnimationStartTimeState(startTime);
        setIsAnimatingState(true);

        // Update schema after animation completes
        animationTimeoutRef.current = setTimeout(() => {
          // Update schema with target positions from schemaLayout
          // Tables should be at exact target positions by now (Table3D snaps to exact target when progress >= 1)
          setCurrentSchema(schemaLayout);

          // Keep isAnimatingRef true until schema update is confirmed
          // This prevents RelationshipLines from flashing when it falls back to table.position
          // RelationshipLines fall back to table.position once the map is cleared
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // Now safe to clear - schema should be updated and RelationshipLines will use table.position
              isAnimatingRef.current = false;
              animatedPositionsRef.current.clear();
              setAnimationStartTimeState(null);
              setIsAnimatingState(false);
              animationTimeoutRef.current = null;
            });
          });
        }, 1000);

        return prevSchema; // Don't update schema yet, wait for animation
      });
    },
    [setCurrentSchema, setAnimationStartTimeState, setIsAnimatingState]
  );

  return {
    targetPositions,
    animationStartTime: animationStartTimeState,
    isAnimating: isAnimatingState,
    animatedPositionsRef,
    startTableAnimation,
  };
}
