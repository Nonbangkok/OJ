// Reference solution: copy the other array in, then BUILD a heap out of the
// whole thing bottom-up.
//
// The two parts:
//
//   * make room once — ensureCapacity(mSize + other.mSize) — and append
//     other's elements verbatim. Appending them with push() would be the
//     whole mistake: that is m calls of fixUp, O(m log(n+m)) in the worst
//     case, and the worst case is exactly what equal elements produce.
//   * re-establish the heap property with fixDown on every node that has a
//     child, from the LAST such node down to index 0. Going bottom-up is what
//     makes this O(n+m) and not O((n+m) log(n+m)): when fixDown(i) runs, both
//     subtrees of i are already heaps, which is its precondition. Top-down
//     (index 0 upwards) does not satisfy it and simply does not work.
//
// Then empty `other` — the statement requires it, and the grader prints
// other.size() after every merge. `other` is another object of the same
// class, so its protected members are reachable from here.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
void CP::priority_queue<T, Comp>::merge(CP::priority_queue<T, Comp> &other)
{
  // Your code here
  if (other.mSize == 0)
    return;

  ensureCapacity(mSize + other.mSize);
  for (size_t i = 0; i < other.mSize; i++)
    mData[mSize + i] = other.mData[i];
  mSize += other.mSize;
  other.mSize = 0;

  size_t node = mSize / 2;
  while (node > 0)
  {
    node--;
    fixDown(node);
  }
}

#endif
