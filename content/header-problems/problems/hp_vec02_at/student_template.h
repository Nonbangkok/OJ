#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
T &CP::vector<T>::at(size_t index)
{
  // Your code here
  return mData[index];
}

template <typename T>
const T &CP::vector<T>::at(size_t index) const
{
  // Your code here
  return mData[index];
}

#endif
