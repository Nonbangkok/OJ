// Reference solution: reduce k, then turn the ring the SHORT way round.
//
// Rotating forward by r and rotating backward by mSize - r give the same
// queue, so the cost is O(min(r, mSize - r)) and both ends are O(1).
//
// One step forward: the element at mFront is copied into the free slot just
// after the back, then mFront moves one slot right. When the array happens to
// be exactly full that slot IS mFront, so the copy is a self-assignment and
// still correct.
//
// One step backward: mFront moves one slot left first, and the old last
// element is copied into it — after the move, (mFront + mSize) % mCap is
// exactly the slot the old back used to occupy.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::rotate(size_t k)
{
  // Your code here
  if (mSize == 0)
    return;

  size_t steps = k % mSize; // k may be billions; only the remainder matters
  if (steps == 0)
    return;

  if (steps <= mSize - steps)
  {
    for (size_t done = 0; done < steps; ++done)
    {
      mData[(mFront + mSize) % mCap] = mData[mFront];
      mFront = (mFront + 1) % mCap;
    }
  }
  else
  {
    for (size_t done = 0; done < mSize - steps; ++done)
    {
      mFront = (mFront + mCap - 1) % mCap;
      mData[mFront] = mData[(mFront + mSize) % mCap];
    }
  }
}

#endif
