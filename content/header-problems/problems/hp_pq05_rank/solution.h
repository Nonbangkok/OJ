// Reference solution: count the elements that are STRICTLY more important
// than mData[i].
//
// "Strictly more important than x" is mLess(x, y) — note the operand order,
// and note that an element of equal importance does NOT count, which is why
// mLess(x, y) is the right test and !mLess(y, x) is not. The scan is O(n),
// which the statement allows: no arrangement of a heap lets you count this in
// less time in the worst case, since the answer can be as large as mSize - 1.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
size_t CP::priority_queue<T, Comp>::rank(size_t i) const
{
  // Your code here
  if (i >= mSize)
    throw std::out_of_range("index out of range");

  size_t greater = 0;
  for (size_t j = 0; j < mSize; j++)
  {
    if (mLess(mData[i], mData[j]))
      greater++;
  }
  return greater;
}

#endif
