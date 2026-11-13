// Reference solution: make room once, then move each element at most once.
//
//   1. ensureCapacity(mSize + m) — ONE growth for the whole block. Asking for
//      room m times (or, worse, inserting one element at a time) is what
//      turns this into a quadratic function.
//   2. slide the tail [pos, mSize) right by m, walking BACKWARDS so a long
//      block never overwrites elements it has not moved yet.
//   3. copy the m new values into the hole.
//
// Total: O(n + m) with no extra memory beyond the one capacity growth.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::range_insert(size_t pos, const std::vector<T> &values)
{
  // Your code here
  size_t m = values.size();
  if (m == 0 || pos > mSize)
  {
    return;
  }
  ensureCapacity(mSize + m);
  for (size_t i = mSize; i > pos; i--)
  {
    mData[i + m - 1] = mData[i - 1];
  }
  for (size_t j = 0; j < m; j++)
  {
    mData[pos + j] = values[j];
  }
  mSize += m;
}

#endif
