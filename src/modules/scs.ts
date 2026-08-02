/* @vendored-from coloring-book:src/modules/scs.ts
   @sha f9c718c
   @status verbatim */
/**
 * Shortest Common Supersequence (SCS) module
 * Uses dynamic programming to find the exact optimal solution
 * Enhanced version includes alignment information
 */

export type Sequence<T> = T[];

/**
 * Represents how an element from an input sequence aligns to the supersequence
 */
export interface SequenceAlignment<T> {
  sequenceIndex: number; // Which input sequence this is (0, 1, 2, ...)
  inputPosition: number; // Position in the original input sequence
  supersequencePosition: number; // Position in the optimal supersequence
  element: T; // The actual element
}

/**
 * Result from enhanced SCS computation
 */
export interface SCSResult<T> {
  supersequence: Sequence<T>;
  alignments: SequenceAlignment<T>[];
}

/**
 * Helper class to work with SCS results
 */
export class SCSResultHelper<T> {
  constructor(private result: SCSResult<T>) {}

  /**
   * Get alignments for a specific input sequence
   */
  getAlignmentForSequence(sequenceIndex: number): SequenceAlignment<T>[] {
    return this.result.alignments.filter(
      (a) => a.sequenceIndex === sequenceIndex
    );
  }

  /**
   * Get position mapping for a specific sequence (inputPos -> superPos)
   */
  getPositionMapping(sequenceIndex: number): Map<number, number> {
    const map = new Map<number, number>();
    this.getAlignmentForSequence(sequenceIndex).forEach((alignment) => {
      map.set(alignment.inputPosition, alignment.supersequencePosition);
    });
    return map;
  }

  /**
   * Get reverse position mapping (superPos -> inputPos)
   */
  getReversePositionMapping(sequenceIndex: number): Map<number, number> {
    const map = new Map<number, number>();
    this.getAlignmentForSequence(sequenceIndex).forEach((alignment) => {
      map.set(alignment.supersequencePosition, alignment.inputPosition);
    });
    return map;
  }

  /**
   * Check if a sequence has an element at a specific supersequence position
   */
  hasElementAt(sequenceIndex: number, supersequencePosition: number): boolean {
    return this.result.alignments.some(
      (a) =>
        a.sequenceIndex === sequenceIndex &&
        a.supersequencePosition === supersequencePosition
    );
  }

  /**
   * Get the element from a sequence at a specific supersequence position
   */
  getElementAt(
    sequenceIndex: number,
    supersequencePosition: number
  ): T | undefined {
    const alignment = this.result.alignments.find(
      (a) =>
        a.sequenceIndex === sequenceIndex &&
        a.supersequencePosition === supersequencePosition
    );
    return alignment?.element;
  }
}

/**
 * Computes the exact shortest common supersequence for multiple sequences
 * Uses dynamic programming with memoization for optimal results
 * @param sequences Array of sequences to find the SCS for
 * @returns The shortest common supersequence (exact)
 */
export function shortestCommonSupersequence<T>(
  sequences: Sequence<T>[]
): Sequence<T> {
  if (sequences.length === 0) {
    return [];
  }
  if (sequences.length === 1) {
    return [...sequences[0]];
  }

  // Filter out empty sequences
  const nonEmptySequences = sequences.filter((seq) => seq.length > 0);
  if (nonEmptySequences.length === 0) {
    return [];
  }
  if (nonEmptySequences.length === 1) {
    return [...nonEmptySequences[0]];
  }

  // Deduplicate sequences - only keep unique sequences
  const uniqueSequences: Sequence<T>[] = [];
  const seenSequences = new Set<string>();

  for (const seq of nonEmptySequences) {
    const seqStr = JSON.stringify(seq);
    if (!seenSequences.has(seqStr)) {
      seenSequences.add(seqStr);
      uniqueSequences.push(seq);
    }
  }

  if (uniqueSequences.length === 0) {
    return [];
  }
  if (uniqueSequences.length === 1) {
    return [...uniqueSequences[0]];
  }

  // Use dynamic programming to find exact SCS on unique sequences only
  return computeExactSCS(uniqueSequences);
}

/**
 * Computes the exact SCS using dynamic programming with memoization
 */
function computeExactSCS<T>(sequences: Sequence<T>[]): Sequence<T> {
  const memo = new Map<string, Sequence<T>>();
  const MAX_MEMO_SIZE = 50000; // Prevent memory exhaustion

  function scsRecursive(positions: number[]): Sequence<T> {
    // Check if memo is getting too large (indicates potential infinite recursion)
    if (memo.size > MAX_MEMO_SIZE) {
      console.error(
        'SCS: Memo size exceeded maximum, likely infinite recursion detected'
      );
      console.error('Current positions:', positions);
      console.error('Sequences:', sequences);
      // Return a fallback result - just concatenate all sequences
      return sequences.flat();
    }
    // Create cache key from current positions
    const key = positions.join(',');
    if (memo.has(key)) {
      return memo.get(key)!;
    }

    // Base case: if all sequences are fully consumed, return empty array
    if (positions.every((pos, i) => pos >= sequences[i].length)) {
      const result: T[] = [];
      memo.set(key, result);
      return result;
    }

    // Check if all active sequences have the same current element
    const activeSequences = positions
      .map((pos, i) => (pos < sequences[i].length ? i : -1))
      .filter((i) => i !== -1);

    if (activeSequences.length > 0) {
      const currentElements = activeSequences.map(
        (i) => sequences[i][positions[i]]
      );
      const firstElement = currentElements[0];
      const allSame = currentElements.every(
        (el) => JSON.stringify(el) === JSON.stringify(firstElement)
      );

      if (allSame) {
        // All active sequences have the same current element, include it once
        const newPositions = [...positions];
        activeSequences.forEach((i) => newPositions[i]++);
        const rest = scsRecursive(newPositions);
        const result = [firstElement, ...rest];
        memo.set(key, result);
        return result;
      }
    }

    // Try advancing each sequence individually and pick the best result
    let bestResult: Sequence<T> = [];
    let bestLength = Infinity;

    for (let i = 0; i < sequences.length; i++) {
      if (positions[i] < sequences[i].length) {
        const newPositions = [...positions];
        newPositions[i]++;

        const rest = scsRecursive(newPositions);
        const result = [sequences[i][positions[i]], ...rest];

        if (result.length < bestLength) {
          bestLength = result.length;
          bestResult = result;
        }
      }
    }

    memo.set(key, bestResult);
    return bestResult;
  }

  const initialPositions = new Array(sequences.length).fill(0);
  return scsRecursive(initialPositions);
}

/**
 * Enhanced SCS function that returns both supersequence and alignments
 * This eliminates the need for manual alignment logic and prevents bugs
 */
export function shortestCommonSupersequenceWithAlignments<T>(
  sequences: Sequence<T>[]
): SCSResult<T> {
  // Get the optimal supersequence using existing algorithm
  const supersequence = shortestCommonSupersequence(sequences);

  // Compute alignments for each input sequence
  const alignments = computeAlignments(sequences, supersequence);

  return {
    supersequence,
    alignments,
  };
}

/**
 * Compute how each input sequence aligns to the supersequence
 */
function computeAlignments<T>(
  sequences: Sequence<T>[],
  supersequence: Sequence<T>
): SequenceAlignment<T>[] {
  const alignments: SequenceAlignment<T>[] = [];

  sequences.forEach((sequence, sequenceIndex) => {
    let inputPosition = 0;

    // Walk through supersequence and find matches with this input sequence
    for (
      let superPosition = 0;
      superPosition < supersequence.length && inputPosition < sequence.length;
      superPosition++
    ) {
      if (
        JSON.stringify(sequence[inputPosition]) ===
        JSON.stringify(supersequence[superPosition])
      ) {
        alignments.push({
          sequenceIndex,
          inputPosition,
          supersequencePosition: superPosition,
          element: sequence[inputPosition],
        });
        inputPosition++;
      }
    }
  });

  return alignments;
}
