// Reference solution: the i-th element from the front lives at the physical
// slot (mFront + i) % mCap. The modulo is the whole problem — once mFront is
// non-zero, mFront + i runs off the end of mData and has to wrap to the front
// of the array. i < mSize <= mCap is guaranteed, so mFront + i cannot
// overflow size_t.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
const T &CP::queue<T>::at(size_t i) const
{
  // Your code here
  return mData[(mFront + i) % mCap];
}

#endif
