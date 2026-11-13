// Reference solution: close the hole from whichever side is nearer.
//
// Dropping position i means the elements on ONE side of it have to slide one
// place. Sliding the tail forwards costs mSize - 1 - i; sliding the head
// backwards costs i, and then mFront moves one slot to the right so the head
// of the queue starts one later. Picking the cheaper side is what turns the
// worst case from Theta(n) per call into O(min(i, n - 1 - i)): erasing at
// either end becomes O(1).
//
// Every slot is addressed as (mFront + position) % mCap, so a run that starts
// near the end of mData simply continues at its start.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::erase(size_t i)
{
  // Your code here
  if (i >= mSize)
    return;

  if (i < mSize - 1 - i)
  {
    // The head is the shorter side: slide positions 0 .. i-1 one place back
    // and let the queue start one slot later.
    for (size_t position = i; position > 0; --position)
    {
      mData[(mFront + position) % mCap] = mData[(mFront + position - 1) % mCap];
    }
    mFront = (mFront + 1) % mCap;
  }
  else
  {
    // The tail is the shorter side: slide positions i+1 .. mSize-1 forwards.
    for (size_t position = i; position + 1 < mSize; ++position)
    {
      mData[(mFront + position) % mCap] = mData[(mFront + position + 1) % mCap];
    }
  }
  mSize--;
}

#endif
