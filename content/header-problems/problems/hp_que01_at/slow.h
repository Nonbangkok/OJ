// Deliberately naive reference: instead of computing the slot with one
// modulo, it walks forward one slot at a time, so at(i) costs Theta(i).
//
// It is CORRECT, only slower — and slow enough to matter: the grader's
// `digest` command reads every position of the queue, so on the large cases
// this version is quadratic. verify.py requires it to be Accepted on cases
// 1-7 and to time out on case 8, which is what proves the last subtask
// really separates O(1) access from walking the ring.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
const T &CP::queue<T>::at(size_t i) const
{
  size_t index = mFront;
  for (size_t step = 0; step < i; ++step)
  {
    index = index + 1;
    if (index == mCap)
      index = 0;
  }
  return mData[index];
}

#endif
