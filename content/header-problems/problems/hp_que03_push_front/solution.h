// Reference solution: no existing element moves. The free slot just before
// mFront belongs to the queue as much as the ones after the back, so stepping
// mFront one slot to the left (around the ring) and writing there is O(1).
//
// Order matters: ensureCapacity may call expand(), which re-packs the data
// from slot 0, sets mFront to 0 and changes mCap — so mFront and mCap must be
// read AFTER it, never before. Adding mCap before the modulo keeps the
// arithmetic inside the unsigned range when mFront is 0.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::push_front(const T &element)
{
  // Your code here
  ensureCapacity(mSize + 1);
  mFront = (mFront + mCap - 1) % mCap;
  mData[mFront] = element;
  mSize++;
}

#endif
