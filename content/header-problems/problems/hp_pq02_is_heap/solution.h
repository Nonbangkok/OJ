// Reference solution: walk the children, not the parents.
//
// Index c (1 <= c < mSize) is a child of (c-1)/2, and EVERY parent-child pair
// in the array shows up exactly once as such a c. One pass over c therefore
// checks both children of every node — including the single-child node that a
// "for every parent, check 2i+1 and 2i+2" loop so easily gets wrong — and it
// is O(n) with one comparison per element.
//
// The property is "the parent is NOT less important than the child", i.e.
// !mLess(parent, child). Testing mLess(child, parent) instead would be wrong
// for equal elements.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
bool CP::priority_queue<T, Comp>::is_heap() const
{
  // Your code here
  for (size_t c = 1; c < mSize; c++)
  {
    if (mLess(mData[(c - 1) / 2], mData[c]))
      return false;
  }
  return true;
}

#endif
