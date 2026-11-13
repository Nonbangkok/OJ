// Reference solution: nothing moves. The queue occupies the mSize slots that
// start at mFront, so dropping the last one is exactly "the queue is one
// shorter" — mFront must stay put, or the FRONT element would be the one that
// disappeared.
//
// The guard is the whole difficulty: mSize is a size_t, so decrementing it at
// zero wraps to 2^64 - 1 instead of going negative, and every later command
// would read far outside mData.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
void CP::queue<T>::pop_back()
{
  // Your code here
  if (mSize == 0)
    return;
  mSize--;
}

#endif
