// Reference solution: find it, fill the hole with the last element, then
// repair in whichever direction that element needs.
//
// Three things make this harder than it looks:
//
//   * "the same value" cannot be written with ==, because T need not have
//     one (the grader uses a struct that does not). Two elements have the
//     same priority exactly when neither is less important than the other:
//     !mLess(a, b) && !mLess(b, a).
//   * the element that fills the hole comes from the END of the array, so it
//     may be more important than the hole's parent (climb) or less important
//     than the hole's children (sink) — exactly one of the two can have work
//     to do, so one comparison against the parent picks the direction.
//   * when the element found IS the last one, there is nothing to move and
//     nothing to repair; shrinking is the whole job. Repairing anyway would
//     read mData[mSize] — outside the live part of the array.
//
// Finding the value is Theta(n), which the statement allows; the repair is
// O(log n).
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "priority_queue.h"
using namespace std;

template <typename T, typename Comp>
void CP::priority_queue<T, Comp>::erase(const T &value)
{
  // Your code here
  size_t found = mSize;
  for (size_t i = 0; i < mSize; i++)
  {
    if (!mLess(mData[i], value) && !mLess(value, mData[i]))
    {
      found = i;
      break;
    }
  }
  if (found == mSize)
    return;

  mSize--;
  if (found == mSize)
    return;

  mData[found] = mData[mSize];
  if (found > 0 && mLess(mData[(found - 1) / 2], mData[found]))
    fixUp(found);
  else
    fixDown(found);
}

#endif
