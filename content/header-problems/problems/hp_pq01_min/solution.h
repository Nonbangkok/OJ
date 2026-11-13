// Reference solution: the least important element is always a LEAF.
//
// Every internal node is at least as important as its children, so a node
// that has a child can never be less important than that child; scanning the
// leaves — indices mSize/2 .. mSize-1 — is therefore enough, and it is half
// the array. The comparison is mLess, never `<`, so the same code serves a
// max-heap, a min-heap and a heap over a type with no operator< at all.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
const T &CP::priority_queue<T, Comp>::min() const
{
  // Your code here
  if (mSize == 0)
    throw std::out_of_range("index out of range");

  size_t best = mSize / 2;
  for (size_t i = best + 1; i < mSize; i++)
  {
    if (mLess(mData[i], mData[best]))
      best = i;
  }
  return mData[best];
}

#endif
