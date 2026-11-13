// Deliberately naive reference: instead of computing the slot directly, it
// walks from mFront to the end of the queue one slot at a time, so back()
// costs Theta(mSize).
//
// It is CORRECT, only slower — and slow enough to matter: the grader's
// `digest` command asks for back() on every size the queue passes through,
// so on the large cases this version is quadratic. verify.py requires it to
// be Accepted on cases 1-7 and to time out on case 8, which is what proves
// the last subtask really separates O(1) from walking the ring.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
const T &CP::queue<T>::back() const
{
  size_t index = mFront;
  for (size_t step = 1; step < mSize; ++step)
  {
    index = index + 1;
    if (index == mCap)
      index = 0;
  }
  return mData[index];
}

#endif
