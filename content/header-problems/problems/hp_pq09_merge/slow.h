// Deliberately naive reference: correct, but it absorbs the other heap one
// push() at a time.
//
// That is O(m log(n+m)) instead of O(n+m), and the large cases make the
// logarithm real: their elements come from a span of two or three values, so
// every pushed element ties with its ancestors, and fixUp's loop — which
// stops only when the parent is STRICTLY more important — carries it all the
// way to the root.
//
// It must produce exactly the reference's outputs and only be too slow. It
// does: this problem's grader never addresses the heap by index, so any
// correct merge leaves the same multiset and prints the same lines, however
// the array ends up arranged.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
void CP::priority_queue<T, Comp>::merge(CP::priority_queue<T, Comp> &other)
{
  for (size_t i = 0; i < other.mSize; i++)
    push(other.mData[i]);
  other.mSize = 0;
}

#endif
