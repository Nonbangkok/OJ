// Reference solution: reserve once, copy once.
//
// ensureCapacity(mSize + other.mSize) is the whole difference between
// O(n + m) and O((n + m) * m): it grows the array at most once, and it has to
// happen BEFORE any destination slot is computed, because expand() re-packs
// the data from slot 0 and rewrites both mFront and mCap.
//
// The two queues have their own mCap, so the source index wraps modulo
// other.mCap and the destination index modulo mCap. Emptying `other` is just
// a matter of its counters: its array stays allocated and is reused by the
// next push.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::merge(CP::queue<T> &other)
{
  // Your code here
  if (other.mSize == 0)
    return;

  ensureCapacity(mSize + other.mSize);
  for (size_t j = 0; j < other.mSize; ++j)
  {
    mData[(mFront + mSize + j) % mCap] = other.mData[(other.mFront + j) % other.mCap];
  }
  mSize += other.mSize;

  other.mSize = 0;
  other.mFront = 0;
}

#endif
