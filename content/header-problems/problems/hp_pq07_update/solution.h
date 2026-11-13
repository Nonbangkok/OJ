// Reference solution: write the new value, then repair in exactly ONE
// direction.
//
// The old value is gone, so the slot can be wrong in either direction:
//
//   * the new value may be MORE important than its parent -> it has to climb,
//     which is what fixUp(i) does;
//   * or LESS important than one of its children -> it has to sink, which is
//     what fixDown(i) does.
//
// Which one applies is decided by one comparison against the parent. Only one
// of the two can ever have work to do, because everything else in the array is
// untouched and was a valid heap before — and note that an element of EQUAL
// importance to its parent needs neither, so the test must be the strict
// mLess(parent, new value).
//
// Both helpers are O(log n) and already written in priority_queue.h: the
// whole job is knowing which one to call.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
void CP::priority_queue<T, Comp>::update(size_t i, const T &value)
{
  // Your code here
  if (i >= mSize)
    throw std::out_of_range("index out of range");

  mData[i] = value;
  if (i > 0 && mLess(mData[(i - 1) / 2], mData[i]))
    fixUp(i);
  else
    fixDown(i);
}

#endif
