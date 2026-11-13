// Reference solution: count the descendants one LEVEL at a time, not one node
// at a time.
//
// In the array layout the descendants of i at depth d below it occupy a
// contiguous block of indices: the leftmost is reached by repeating
// left = 2*left + 1 and the rightmost by repeating right = 2*right + 2. The
// block is complete except possibly the last one, where it is cut off at
// mSize - 1. So each level costs O(1) and there are at most log2(mSize)
// levels — O(log n) per query, with no recursion and no extra storage.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
size_t CP::priority_queue<T, Comp>::descendants(size_t i) const
{
  // Your code here
  if (i >= mSize)
    throw std::out_of_range("index out of range");

  size_t count = 0;
  size_t left = i;
  size_t right = i;
  while (true)
  {
    left = 2 * left + 1;
    right = 2 * right + 2;
    if (left >= mSize)
      break;
    if (right >= mSize)
      right = mSize - 1;
    count += right - left + 1;
  }
  return count;
}

#endif
