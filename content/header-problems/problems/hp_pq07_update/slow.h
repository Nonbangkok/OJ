// Deliberately naive reference: correct, but when the new value has to SINK
// it rebuilds the whole heap bottom-up instead of sinking that one element.
//
// This is the version a student writes when the "climb" case feels obvious
// but the "sink" case does not: rebuilding needs no thought about how far the
// element goes. It is Theta(n) per update where the intended repair is
// O(log n), and with random values most updates fall into the sink case.
//
// It is genuinely CORRECT, down to the resulting array: every node other than
// i already satisfies the heap property, so each fixDown in the rebuild is
// either the one real sink at i or a no-op that at most exchanges elements of
// equal priority — and under the graders' comparators equal priority means
// an identical value, so the array of values comes out exactly as the
// reference leaves it. That matters here, because the grader's later updates
// address the array BY INDEX: a version that rearranged the heap differently
// would be wrong rather than slow, and would prove nothing.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
void CP::priority_queue<T, Comp>::update(size_t i, const T &value)
{
  if (i >= mSize)
    throw std::out_of_range("index out of range");

  mData[i] = value;
  if (i > 0 && mLess(mData[(i - 1) / 2], mData[i]))
  {
    fixUp(i);
    return;
  }

  size_t node = mSize / 2;
  while (node > 0)
  {
    node--;
    fixDown(node);
  }
}

#endif
