// Reference solution: hold the element, slide positions 0 .. i-1 one place
// towards the back, then write it into position 0. Every slot is addressed as
// (mFront + position) % mCap, so the run may start near the end of mData and
// continue at its start.
//
// The loop walks DOWNWARDS from i. Going the other way would copy the first
// element over its neighbour before that neighbour had been moved, leaving
// i copies of the same value.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::move_to_front(size_t i)
{
  // Your code here
  if (i == 0 || i >= mSize)
    return; // already at the front: nothing to do

  T hold = mData[(mFront + i) % mCap];
  for (size_t position = i; position > 0; --position)
  {
    mData[(mFront + position) % mCap] = mData[(mFront + position - 1) % mCap];
  }
  mData[mFront] = hold;
}

#endif
