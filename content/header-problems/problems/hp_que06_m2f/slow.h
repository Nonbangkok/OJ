// Deliberately naive reference: it bubbles the element towards the front by
// swapping it with its neighbour over and over. Same O(i) order of growth,
// but three memory writes per step instead of one.
//
// It is CORRECT, only slower. This problem has no complexity subtask
// (meta.json: has_tle_subtask is false), so verify.py never runs this file; it
// is kept so the problem still documents what the naive version looks like.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::move_to_front(size_t i)
{
  if (i == 0 || i >= mSize)
    return;

  for (size_t position = i; position > 0; --position)
  {
    size_t here = (mFront + position) % mCap;
    size_t ahead = (mFront + position - 1) % mCap;
    T hold = mData[here];
    mData[here] = mData[ahead];
    mData[ahead] = hold;
  }
}

#endif
