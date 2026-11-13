// Deliberately naive reference: correct, but it finds the third most
// important element with three passes over the whole array — Theta(n) per
// call instead of O(1).
//
// It must produce exactly the reference's outputs and only be too slow:
// verify.py requires it to pass the first subtask and time out on the first
// case of the last one, which proves the large cases really separate an O(1)
// answer from a scan.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
T CP::priority_queue<T, Comp>::third() const
{
  if (mSize < 3)
    throw std::out_of_range("index out of range");

  size_t first = 0;
  for (size_t i = 1; i < mSize; i++)
    if (mLess(mData[first], mData[i]))
      first = i;

  size_t second = (first == 0) ? 1 : 0;
  for (size_t i = 0; i < mSize; i++)
    if (i != first && mLess(mData[second], mData[i]))
      second = i;

  size_t third = 0;
  while (third == first || third == second)
    third++;
  for (size_t i = 0; i < mSize; i++)
    if (i != first && i != second && mLess(mData[third], mData[i]))
      third = i;

  return mData[third];
}

#endif
