/* @vendored-from coloring-book:src/modules/scs.ts
   @sha 3f42194
   @status verbatim */
/**
 * Shortest Common Supersequence (SCS) module.
 *
 * The exact SCS of k sequences is NP-hard in k, and a naive k-way DP memoises
 * on a position tuple, so its state space is the product of all k input
 * lengths — unusable for real inputs. We instead fold pairwise: each fold is
 * the exact two-sequence SCS, computed with an iterative O(n·m) table and
 * backpointers (no recursion, no memo-size guard, bounded memory). Folding is
 * not guaranteed to yield the globally shortest supersequence, but the result
 * always contains every input, and it runs in predictable time and space for
 * any input. Enhanced entry point additionally returns alignment information.
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
 * Common supersequence of many sequences, built by pairwise folding of the
 * exact two-sequence SCS. Deduplicates identical inputs first. The result
 * contains every input; it is not guaranteed to be globally shortest.
 * @param sequences Array of sequences to find a common supersequence for
 * @returns A common supersequence of every input
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

  // Fold pairwise: each fold is the exact two-sequence SCS. Order follows
  // first appearance in the input, which lets a caller front-load the
  // dominant sequence to steer fold quality.
  let acc = uniqueSequences[0];
  for (let i = 1; i < uniqueSequences.length; i++) {
    acc = shortestCommonSupersequencePair(acc, uniqueSequences[i]);
  }
  return acc;
}

/** Stable equality key for an element (primitives compare directly). */
function elementKey<T>(element: T): string {
  return typeof element === 'string' ? element : JSON.stringify(element);
}

/**
 * Exact shortest common supersequence of two sequences.
 *
 * Iterative bottom-up DP: `dp[i][j]` is the SCS length of the first `i`
 * elements of `a` and the first `j` of `b`. The supersequence is recovered by
 * walking the table back from `(n, m)`. O(n·m) time and memory, with no
 * recursion and no fallback path — the failure mode of the old k-way memo is
 * gone.
 */
function shortestCommonSupersequencePair<T>(
  a: Sequence<T>,
  b: Sequence<T>
): Sequence<T> {
  const n = a.length;
  const m = b.length;
  if (n === 0) {
    return [...b];
  }
  if (m === 0) {
    return [...a];
  }

  const keyA = a.map(elementKey);
  const keyB = b.map(elementKey);

  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = 0; i <= n; i++) {
    dp[i * width] = i;
  }
  for (let j = 0; j <= m; j++) {
    dp[j] = j;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (keyA[i - 1] === keyB[j - 1]) {
        dp[i * width + j] = dp[(i - 1) * width + (j - 1)] + 1;
      } else {
        const fromA = dp[(i - 1) * width + j];
        const fromB = dp[i * width + (j - 1)];
        dp[i * width + j] = 1 + (fromA <= fromB ? fromA : fromB);
      }
    }
  }

  // Reconstruct in reverse; ties resolve toward `a` to match the length DP.
  const result: T[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (keyA[i - 1] === keyB[j - 1]) {
      result.push(a[i - 1]);
      i--;
      j--;
    } else if (dp[(i - 1) * width + j] <= dp[i * width + (j - 1)]) {
      result.push(a[i - 1]);
      i--;
    } else {
      result.push(b[j - 1]);
      j--;
    }
  }
  while (i > 0) {
    result.push(a[--i]);
  }
  while (j > 0) {
    result.push(b[--j]);
  }
  result.reverse();
  return result;
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
  const superKeys = supersequence.map(elementKey);

  sequences.forEach((sequence, sequenceIndex) => {
    const seqKeys = sequence.map(elementKey);
    let inputPosition = 0;

    // Walk through supersequence and find matches with this input sequence
    for (
      let superPosition = 0;
      superPosition < supersequence.length && inputPosition < sequence.length;
      superPosition++
    ) {
      if (seqKeys[inputPosition] === superKeys[superPosition]) {
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
