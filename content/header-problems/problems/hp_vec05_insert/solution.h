// Reference solution.
//
// Two separate jobs, and the complexity of this problem lives in the first:
//
//   1. make room. ensureCapacity(mSize + 1) is the class's own growth rule:
//      when the array is full it expands to max(wanted, 2 * mCap), i.e. it
//      DOUBLES. Doubling is what makes a run of q appends cost O(q) in total
//      (amortized O(1) each) instead of O(q^2) — see slow.h for the version
//      that asks for exactly one more slot every time.
//   2. shift the tail right by one, from the back so nothing is overwritten,
//      then drop the new value into the hole.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::insert(size_t pos, const T &value)
{
  // Your code here
  if (pos > mSize)
  {
    return;
  }
  // Copy the value first: `value` may be a reference to an element of this
  // very vector, and the shift below would then move it out from under us.
  T hold = value;
  ensureCapacity(mSize + 1);
  for (size_t i = mSize; i > pos; i--)
  {
    mData[i] = mData[i - 1];
  }
  mData[pos] = hold;
  mSize++;
}

#endif
