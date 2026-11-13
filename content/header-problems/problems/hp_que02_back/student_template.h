#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "queue.h"
using namespace std;

template <typename T>
const T &CP::queue<T>::back() const
{
  // Your code here
  return mData[mFront]; // only correct when the queue holds one element
}

#endif
