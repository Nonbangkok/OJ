// Deliberately naive reference: it bubbles the element towards the back by
// swapping it with its neighbour over and over. Same O(size - i) order of
// growth, but three memory writes per step instead of one, and no temporary
// to reason about.
//
// It is CORRECT, only slower. This problem has no complexity subtask
// (meta.json: has_tle_subtask is false), so verify.py never runs this file; it
// is kept so the problem still documents what the naive version looks like.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::move_to_back(size_t i)
{
  if (mSize == 0 || i + 1 >= mSize)
    return;

  for (size_t position = i; position + 1 < mSize; ++position)
  {
    size_t here = (mFront + position) % mCap;
    size_t next = (mFront + position + 1) % mCap;
    T hold = mData[here];
    mData[here] = mData[next];
    mData[next] = hold;
  }
}

#endif
