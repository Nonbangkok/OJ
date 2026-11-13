// Reference solution: hold the element, close the hole it leaves by sliding
// everything behind it one position towards the front, then write it into the
// last position. Every slot is addressed as (mFront + position) % mCap, so the
// run of positions may start near the end of mData and continue at its start.
//
// The copy out of the ring comes FIRST: the very first assignment of the loop
// overwrites that slot.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::move_to_back(size_t i)
{
  // Your code here
  if (mSize == 0 || i + 1 >= mSize)
    return; // already the last element: nothing to do

  T hold = mData[(mFront + i) % mCap];
  for (size_t position = i; position + 1 < mSize; ++position)
  {
    mData[(mFront + position) % mCap] = mData[(mFront + position + 1) % mCap];
  }
  mData[(mFront + mSize - 1) % mCap] = hold;
}

#endif
